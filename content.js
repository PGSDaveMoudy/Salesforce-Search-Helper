// Patch history methods to dispatch a custom event on navigation.
(function(history) {
  const pushState = history.pushState;
  history.pushState = function (...args) {
    const result = pushState.apply(history, args);
    window.dispatchEvent(new Event("location-changed"));
    return result;
  };
})(window.history);

window.addEventListener("popstate", () => {
  window.dispatchEvent(new Event("location-changed"));
});

(async function() {
  let customQuickFindInput = null;

  // Exports table data to CSV when the Export CSV button is clicked
  function exportCSV() {
    const tableBody = document.querySelector("table tbody");
    if (!tableBody) {
      console.error("Table not found for export.");
      return;
    }
    const rows = tableBody.querySelectorAll("tr");
    let csvContent = "Field Label,API Name,Field Type,Field Values\n";

    // Simple CSV escape function
    const escapeCSV = (text) => {
      if (text.includes(',') || text.includes('"') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;
      const fieldLabel = cells[0].innerText.trim();
      const apiName = cells[1].innerText.trim();
      const fieldType = cells[2].innerText.trim();
      const picklistText = row.dataset.picklistText ? row.dataset.picklistText.trim() : "";
      csvContent += `${escapeCSV(fieldLabel)},${escapeCSV(apiName)},${escapeCSV(fieldType)},${escapeCSV(picklistText)}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "salesforce_fields_export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function isObjectManagerPage() {
    return window.location.pathname.includes("/lightning/setup/ObjectManager/");
  }

  function isObjectManagerHomePage() {
    return window.location.pathname.includes("/lightning/setup/ObjectManager/home");
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for element: ${selector}`));
      }, timeout);
    });
  }

  function autoScrollAndWait(container) {
    return new Promise(resolve => {
      let lastHeight = container.scrollHeight;

      function scrollStep() {
        container.scrollTop = container.scrollHeight;
        setTimeout(() => {
          const newHeight = container.scrollHeight;
          if (newHeight > lastHeight) {
            lastHeight = newHeight;
            scrollStep();
          } else {
            resolve();
          }
        }, 500);
      }
      scrollStep();
    });
  }

  function getObjectNameFromURL() {
    const match = window.location.pathname.match(/ObjectManager\/([^\/]+)/);
    return match && match[1] ? decodeURIComponent(match[1]) : null;
  }

  function setupCustomQuickFind(originalInput) {
    if (!originalInput) {
      console.error("Original Quick Find input not found.");
      return;
    }

    if (originalInput.dataset.customized === "true") {
      console.log("Custom Quick Find input already set up.");
      return;
    }

    console.log("Setting up custom Quick Find...");
    const newInput = originalInput.cloneNode(true);
    newInput.id = "customQuickFind";
    newInput.dataset.customized = "true";

    if (originalInput.parentNode) {
      console.log("Replacing Quick Find input.");
      originalInput.parentNode.replaceChild(newInput, originalInput);
    } else {
      console.warn("No parent found for Quick Find input.");
      return;
    }

    // Create and insert Export CSV button with nicer styling
    if (!document.getElementById("exportCsvButton")) {
      const exportButton = document.createElement("button");
      exportButton.id = "exportCsvButton";
      exportButton.textContent = "Export CSV";
      exportButton.style.cssText = `
        background-color: #0070d2;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 5px 10px;
        font-size: 14px;
        cursor: pointer;
        margin-left: 10px;
      `;
      exportButton.addEventListener("click", exportCSV);

      // Try to locate an existing "New" button in the same container
      const parent = newInput.parentNode;
      let newButton = Array.from(parent.children).find(el =>
        el.tagName === "BUTTON" && el.textContent.trim() === "New"
      );
      if (newButton) {
        newButton.parentNode.insertBefore(exportButton, newButton.nextSibling);
      } else {
        // Fallback: insert to the right of the input
        parent.insertBefore(exportButton, newInput.nextSibling);
      }
    }

    customQuickFindInput = newInput;
    newInput.addEventListener("input", onQuickFindInput);
    console.log("Custom Quick Find and Export CSV button attached.");
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
      row.style.display =
        searchValue === "" ||
        combinedSearchText.includes(searchValue) ||
        apiName.includes(searchValue) ||
        fieldType.includes(searchValue)
          ? ""
          : "none";
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
          const picklistText = response.data.picklistText || "";
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
      if (row.dataset.picklistFetched === "true") return;
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
      row.dataset.picklistFetched = "true";
    });
  }

  async function initPicklistProcessing() {
    if (isObjectManagerHomePage()) {
      console.log("Object Manager home page detected – skipping initialization.");
      return;
    }
    if (!isObjectManagerPage()) {
      console.log("Not on an Object Manager page – skipping initialization.");
      return;
    }
    try {
      const originalQuickFind = await waitForElement("input#globalQuickfind");
      console.log("Global Quick Find input found.");
      await waitForElement("table tbody");

      const container = document.querySelector(".scroller.uiScroller.scroller-wrapper.scroll-bidirectional.native");
      if (container) {
        await autoScrollAndWait(container);
        console.log("Finished auto scrolling.");
      }

      setupCustomQuickFind(originalQuickFind);
      processPicklistRows();

      const tableBody = document.querySelector("table tbody");
      if (tableBody) {
        const observer = new MutationObserver(mutations => {
          if (mutations.some(mutation => mutation.addedNodes.length)) {
            processPicklistRows();
          }
        });
        observer.observe(tableBody, { childList: true });
      }
      console.log("Custom Quick Find, Export CSV, and picklist fetch setup complete.");
    } catch (error) {
      console.error("Error initializing picklist processing:", error);
    }
  }

  const pageObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches("table tbody") || node.querySelector("table tbody")) {
            console.log("Detected table in DOM changes, reinitializing picklist processing.");
            initPicklistProcessing();
            return;
          }
        }
      }
    }
  });

  pageObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("location-changed", () => {
    console.log("Navigation detected.");
    initPicklistProcessing();
  });
  await initPicklistProcessing();
})();
