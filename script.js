// script.js

// ================================
// BACKGROUND SERVICE WORKER CODE
// ================================
if (typeof document === 'undefined') {
  // Helper: Retrieve the session cookie ("sid") for the given origin.
  function getSessionCookie(origin, callback) {
    let cookieUrl = origin;
    // If on a Lightning domain, swap to my.salesforce.com.
    if (cookieUrl.indexOf("lightning.force.com") !== -1) {
      cookieUrl = cookieUrl.replace("lightning.force.com", "my.salesforce.com");
    }
    chrome.cookies.get({ url: cookieUrl, name: "sid" }, function(cookie) {
      if (cookie) {
        callback(cookie.value);
      } else {
        callback(null);
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "fetchPicklistValues") {
      const { objectName, fieldApiName, origin, isStandard } = message;
      getSessionCookie(origin, function(sessionId) {
        if (!sessionId) {
          sendResponse({ success: false, error: "No session cookie found." });
          return;
        }
        // For both standard and custom fields, ensure we call the API on my.salesforce.com.
        let apiOrigin = origin;
        if (apiOrigin.indexOf("lightning.force.com") !== -1) {
          apiOrigin = apiOrigin.replace("lightning.force.com", "my.salesforce.com");
        }
        if (isStandard) {
          // For standard fields, use the object's describe endpoint.
          const url = `${apiOrigin}/services/data/v56.0/sobjects/${objectName}/describe`;
          fetch(url, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + sessionId
            }
          })
            .then(response => {
              if (!response.ok) {
                throw new Error(`Describe API error: ${response.status}`);
              }
              return response.json();
            })
            .then(data => {
              const field = data.fields.find(f => f.name === fieldApiName);
              if (field && field.picklistValues && field.picklistValues.length > 0) {
                const picklistText = field.picklistValues
                  .map(v => (v.label || "").toLowerCase())
                  .join(", ");
                sendResponse({ success: true, data: { picklistText } });
              } else {
                sendResponse({ success: true, data: { picklistText: "" } });
              }
            })
            .catch(err => {
              console.error("Error fetching describe for standard field:", err);
              sendResponse({ success: false, error: err.toString() });
            });
        } else {
          const query = `SELECT Metadata FROM CustomField WHERE DeveloperName = '${fieldApiName}' AND TableEnumOrId = '${objectName}'`;
          const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;
          fetch(url, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + sessionId
            }
          })
            .then(response => {
              if (!response.ok) {
                throw new Error(`Tooling API error: ${response.status}`);
              }
              return response.json();
            })
            .then(data => {
              let picklistText = "";
              if (
                data.records &&
                data.records.length > 0 &&
                data.records[0].Metadata &&
                data.records[0].Metadata.valueSet &&
                data.records[0].Metadata.valueSet.valueSetDefinition &&
                Array.isArray(data.records[0].Metadata.valueSet.valueSetDefinition.value)
              ) {
                const values = data.records[0].Metadata.valueSet.valueSetDefinition.value;
                picklistText = values.map(v => (v.label || "").toLowerCase()).join(", ");
              }
              sendResponse({ success: true, data: { picklistText } });
            })
            .catch(err => {
              console.error("Error fetching picklist values in background:", err);
              sendResponse({ success: false, error: err.toString() });
            });
        }
      });
      return true;
    }
  });
} else {
  // ================================
  // CONTENT SCRIPT CODE
  // ================================
  (function() {
    let customQuickFindInput = null;

    function waitForElement(selector, callback) {
      const element = document.querySelector(selector);
      if (element) {
        callback(element);
      } else {
        setTimeout(() => waitForElement(selector, callback), 500);
      }
    }

    function waitForAllRows(callback) {
      const tableBody = document.querySelector("table tbody");
      if (!tableBody) {
        callback();
        return;
      }
      let lastCount = tableBody.querySelectorAll("tr").length;
      let stableCounter = 0;
      const interval = setInterval(() => {
        const currentCount = tableBody.querySelectorAll("tr").length;
        if (currentCount === lastCount) {
          stableCounter++;
          if (stableCounter >= 3) {
            clearInterval(interval);
            callback();
          }
        } else {
          lastCount = currentCount;
          stableCounter = 0;
        }
      }, 500);
      setTimeout(() => {
        clearInterval(interval);
        callback();
      }, 5000);
    }

    function getObjectNameFromURL() {
      const match = window.location.pathname.match(/ObjectManager\/([^\/]+)/);
      return match && match[1] ? decodeURIComponent(match[1]) : null;
    }

    // Modified setupCustomQuickFind prevents double-replacement.
    function setupCustomQuickFind(originalInput) {
      if (originalInput.dataset.customized === "true") {
        console.log("Custom Quick Find input already set up.");
        return;
      }
      const newInput = originalInput.cloneNode(true);
      newInput.id = "globalQuickfind";
      newInput.dataset.customized = "true";
      if (originalInput.parentNode) {
        originalInput.parentNode.replaceChild(newInput, originalInput);
        console.log("Replaced original Quick Find input with a clone.");
      } else {
        console.warn("Original Quick Find input has no parent; skipping replacement.");
      }
      customQuickFindInput = newInput;
      newInput.addEventListener("input", onQuickFindInput);
      console.log("Custom Quick Find event listener attached.");
    }

    function onQuickFindInput(e) {
      const searchValue = e.target.value.trim().toLowerCase();
      const tableBody = document.querySelector("table tbody");
      if (!tableBody) {
        console.error("Data table not found when processing search input.");
        return;
      }
      const rows = tableBody.querySelectorAll("tr");
      rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 3) return;
        const fieldLabel = cells[0].innerText.toLowerCase();
        const apiName = cells[1].innerText.toLowerCase();
        const fieldType = cells[2].innerText.toLowerCase();
        const picklistText = row.dataset.picklistText ? row.dataset.picklistText.toLowerCase() : "";
        const combinedSearchText = fieldLabel + " " + picklistText;
        if (
          searchValue === "" ||
          combinedSearchText.includes(searchValue) ||
          apiName.includes(searchValue) ||
          fieldType.includes(searchValue)
        ) {
          row.style.display = "";
        } else {
          row.style.display = "none";
        }
      });
    }

    function fetchPicklistValuesViaBackground(row, objectName, fieldApiName, isStandard) {
      const origin = window.location.origin;
      chrome.runtime.sendMessage(
        {
          type: "fetchPicklistValues",
          objectName,
          fieldApiName,
          origin,
          isStandard
        },
        response => {
          if (response && response.success) {
            const data = response.data;
            const picklistText = data.picklistText || "";
            row.dataset.picklistText = picklistText;
            const labelCell = row.querySelector("td");
            if (labelCell) {
              labelCell.setAttribute("title", picklistText);
            }
            console.log(`Fetched picklist values for ${fieldApiName}: ${picklistText}`);
            if (customQuickFindInput) {
              onQuickFindInput({ target: { value: customQuickFindInput.value } });
            }
          } else {
            console.error("Error fetching picklist values via background:", response && response.error);
          }
        }
      );
    }

    function processPicklistRows() {
      const tableBody = document.querySelector("table tbody");
      if (!tableBody) return;
      const objectName = getObjectNameFromURL();
      if (!objectName) {
        console.error("Cannot determine object name from URL. Picklist fetch skipped.");
        return;
      }
      const rows = tableBody.querySelectorAll("tr");
      rows.forEach(row => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 3) return;
        const fieldType = cells[2].innerText.toLowerCase();
        const fieldApiName = cells[1].innerText.trim();
        const isStandard = !fieldApiName.endsWith("__c");
        if (fieldType.includes("picklist")) {
          fetchPicklistValuesViaBackground(row, objectName, fieldApiName, isStandard);
        } else {
          row.dataset.picklistText = "";
          const labelCell = row.querySelector("td");
          if (labelCell) {
            labelCell.removeAttribute("title");
          }
        }
      });
    }

    function initPicklistProcessing() {
      waitForElement('input#globalQuickfind', globalQuickfind => {
        console.log("Global Quick Find input found.");
        waitForElement("table", table => {
          waitForElement("table tbody", () => {
            const container = document.querySelector(
              '.scroller.uiScroller.scroller-wrapper.scroll-bidirectional.native'
            );
            if (container) {
              container.scrollTop = container.scrollHeight;
              console.log("Auto-scrolled container to bottom for lazy load.");
            }
            waitForAllRows(() => {
              setupCustomQuickFind(globalQuickfind);
              processPicklistRows();
              console.log("Custom Quick Find and picklist fetch setup complete.");
            });
          });
        });
      });
    }

    initPicklistProcessing();

    let lastObjectName = getObjectNameFromURL();
    setInterval(() => {
      const newObjectName = getObjectNameFromURL();
      if (newObjectName !== lastObjectName) {
        console.log("Detected object change – reinitializing picklist processing.");
        lastObjectName = newObjectName;
        initPicklistProcessing();
      }
    }, 2000);
  })();
}
