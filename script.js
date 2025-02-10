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
              // Find the field by its name.
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
          // For custom fields, query the CustomField object via the Tooling API.
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
      // Return true to indicate asynchronous response.
      return true;
    }
  });
} else {
  // ================================
  // CONTENT SCRIPT CODE
  // ================================
  (function() {
    let customQuickFindInput = null; // Global reference for re-triggering filtering

    // Utility: Wait for an element matching a selector.
    function waitForElement(selector, callback) {
      const element = document.querySelector(selector);
      if (element) {
        callback(element);
      } else {
        setTimeout(() => waitForElement(selector, callback), 500);
      }
    }

    // Utility: Wait until the table rows stabilize (i.e. lazy loading is complete)
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
          // After 3 consecutive checks (~1.5 seconds) with no change, assume loading is complete.
          if (stableCounter >= 3) {
            clearInterval(interval);
            callback();
          }
        } else {
          lastCount = currentCount;
          stableCounter = 0;
        }
      }, 500);
      // Safety timeout: if not stable after 5 seconds, proceed anyway.
      setTimeout(() => {
        clearInterval(interval);
        callback();
      }, 5000);
    }

    // Utility: Extract the object name from the URL.
    function getObjectNameFromURL() {
      const match = window.location.pathname.match(/ObjectManager\/([^\/]+)/);
      return match && match[1] ? decodeURIComponent(match[1]) : null;
    }

    // Add a new header cell labeled "Picklist Values" if not already present.
    function addPicklistHeaderColumn() {
      const headerRow = document.querySelector("table thead tr");
      if (headerRow && !headerRow.querySelector("th.picklistColumnHeader")) {
        const th = document.createElement("th");
        th.className = "picklistColumnHeader";
        th.innerText = "Picklist Values";
        headerRow.appendChild(th);
        console.log("Added Picklist Values header column.");
      }
    }

    // Replace the original Quick Find input and attach a custom event listener.
    function setupCustomQuickFind(originalInput) {
      const newInput = originalInput.cloneNode(true);
      newInput.id = "globalQuickfind";
      originalInput.parentNode.replaceChild(newInput, originalInput);
      console.log("Replaced original Quick Find input with a clone.");
      customQuickFindInput = newInput;
      newInput.addEventListener("input", onQuickFindInput);
      console.log("Custom Quick Find event listener attached.");
    }

    // Filter table rows based on the search term.
    // For picklist fields, combine the field label and the visible picklist column.
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
        const picklistCell = row.querySelector("td.picklistColumn");
        const picklistText = picklistCell ? picklistCell.innerText.toLowerCase() : "";
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

    // Send a message to the background script to fetch picklist values.
    // The isStandard flag is true if the field's API name does not end with "__c".
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
            // Add or update a visible cell with class "picklistColumn" in the row.
            let picklistCell = row.querySelector("td.picklistColumn");
            if (!picklistCell) {
              picklistCell = document.createElement("td");
              picklistCell.className = "picklistColumn";
              picklistCell.style.whiteSpace = "nowrap";
              row.appendChild(picklistCell);
            }
            picklistCell.innerText = picklistText;
            console.log(`Fetched picklist values for ${fieldApiName}: ${picklistText}`);
            // Re-run filtering with the current Quick Find input value.
            if (customQuickFindInput) {
              onQuickFindInput({ target: { value: customQuickFindInput.value } });
            }
          } else {
            console.error("Error fetching picklist values via background:", response && response.error);
          }
        }
      );
    }

    // Iterate over table rows; for picklist fields, trigger the fetch.
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
          // For non-picklist rows, add an empty cell for consistency.
          let picklistCell = row.querySelector("td.picklistColumn");
          if (!picklistCell) {
            picklistCell = document.createElement("td");
            picklistCell.className = "picklistColumn";
            picklistCell.innerText = "";
            row.appendChild(picklistCell);
          }
        }
      });
    }

    // Initialization: Wait for the Quick Find input and table to load, add header,
    // scroll the proper container to trigger lazy loading, then wait for rows to stabilize.
    waitForElement('input#globalQuickfind', globalQuickfind => {
      console.log("Global Quick Find input found.");
      waitForElement("table", table => {
        addPicklistHeaderColumn();
        waitForElement("table tbody", () => {
          // Scroll the container with the specified classes to trigger lazy loading.
          const container = document.querySelector(
            '.scroller.uiScroller.scroller-wrapper.scroll-bidirectional.native'
          );
          if (container) {
            container.scrollTop = container.scrollHeight;
            console.log("Auto-scrolled container to bottom for lazy load.");
          }
          // Wait until the table rows stabilize (i.e. lazy loading is complete)
          waitForAllRows(() => {
            setupCustomQuickFind(globalQuickfind);
            processPicklistRows();
            console.log("Custom Quick Find and picklist fetch setup complete.");
          });
        });
      });
    });
  })();
}
