// Patch history methods to dispatch a custom event on navigation.
(function(history) {
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  history.pushState = function (...args) {
    const result = pushState.apply(history, args);
    window.dispatchEvent(new Event("location-changed"));
    return result;
  };
  history.replaceState = function (...args) {
    const result = replaceState.apply(history, args);
    window.dispatchEvent(new Event("location-changed"));
    return result;
  };
})(window.history);

window.addEventListener("popstate", () => {
  window.dispatchEvent(new Event("location-changed"));
});
document.addEventListener("aura:locationChange", () => {
  window.dispatchEvent(new Event("location-changed"));
});
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    window.dispatchEvent(new Event("location-changed"));
  }
}, 500);

let lastObjectName = null;
let customQuickFindInput = null;

(async function() {
  // --- Utility functions ---
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

  function removeSetupHomeModules() {
    document.querySelectorAll("section.onesetupModule").forEach(module => module.remove());
  }

  async function getOriginalQuickFind() {
    const container = await waitForElement(".objectManagerGlobalSearchBox");
    const input = container.querySelector("input[type='search']");
    if (!input) throw new Error("Object Manager Quick Find input not found.");
    return input;
  }

  function setupCustomQuickFind(originalInput) {
    if (!originalInput) {
      console.error("Original Quick Find input not found.");
      return;
    }
    if (originalInput.dataset.customized === "true") {
      console.log("Custom Quick Find already set up.");
      return;
    }
    const newInput = originalInput.cloneNode(true);
    newInput.id = "customQuickFind";
    newInput.dataset.customized = "true";
    originalInput.parentNode.replaceChild(newInput, originalInput);
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
      const parent = newInput.parentNode;
      const newButton = Array.from(parent.children).find(el =>
        el.tagName === "BUTTON" && el.textContent.trim() === "New"
      );
      if (newButton) {
        newButton.parentNode.insertBefore(exportButton, newButton.nextSibling);
      } else {
        parent.insertBefore(exportButton, newInput.nextSibling);
      }
    }
    customQuickFindInput = newInput;
    newInput.addEventListener("input", onQuickFindInput);
    console.log("Custom Quick Find and Export CSV attached.");
  }

  function exportCSV() {
    const tableBody = document.querySelector("table tbody");
    if (!tableBody) {
      console.error("Table not found for export.");
      return;
    }
    const rows = tableBody.querySelectorAll("tr");
    let csvContent = "Field Label,API Name,Field Type,Field Values\n";
    const escapeCSV = text => (text.includes(',') || text.includes('"') || text.includes('\n')) ? `"${text.replace(/"/g, '""')}"` : text;
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salesforce_fields_export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function onQuickFindInput(e) {
    const query = e.target.value.trim().toLowerCase();
    const tableBody = document.querySelector("table tbody");
    if (!tableBody) return;
    const rows = tableBody.querySelectorAll("tr");
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;
      const fieldLabel = cells[0].innerText.toLowerCase();
      const apiName = cells[1].innerText.toLowerCase();
      const fieldType = cells[2].innerText.toLowerCase();
      const picklistText = row.dataset.picklistText ? row.dataset.picklistText.toLowerCase() : "";
      const combined = fieldLabel + " " + picklistText;
      row.style.display = (query === "" || combined.includes(query) || apiName.includes(query) || fieldType.includes(query)) ? "" : "none";
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
          if (labelCell) labelCell.setAttribute("title", picklistText);
          console.log(`Fetched picklist for ${fieldApiName}: ${picklistText}`);
          if (customQuickFindInput) {
            onQuickFindInput({ target: { value: customQuickFindInput.value } });
          }
        } else {
          console.error("Error fetching picklist values:", response && response.error);
        }
      }
    );
  }

  function processPicklistRows() {
    const tableBody = document.querySelector("table tbody");
    if (!tableBody) return;
    const objectName = getObjectNameFromURL();
    if (!objectName) {
      console.error("Could not determine object name.");
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
        if (labelCell) labelCell.removeAttribute("title");
      }
      row.dataset.picklistFetched = "true";
    });
  }

  function addFallbackButton() {
    if (document.getElementById("initializeQuickFindButton")) return;
    const container = document.querySelector(".objectManagerGlobalSearchBox");
    if (!container) return;
    const fallbackBtn = document.createElement("button");
    fallbackBtn.id = "initializeQuickFindButton";
    fallbackBtn.textContent = "Revive Quick Find";
    fallbackBtn.style.cssText = `
      background-color: #ff6f61;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      font-size: 14px;
      cursor: pointer;
      margin-left: 10px;
    `;
    fallbackBtn.addEventListener("click", () => window.location.reload(true));
    container.appendChild(fallbackBtn);
  }

  // --- Main initialization ---
  async function initPicklistProcessing() {
    // Only run on Object Manager pages (skip home page)
    if (!window.location.pathname.includes("/lightning/setup/") || window.location.pathname.includes("/ObjectManager/home"))
      return;
    removeSetupHomeModules();
    const objectName = getObjectNameFromURL();
    if (lastObjectName && lastObjectName !== objectName) {
      const existing = document.getElementById("customQuickFind");
      if (existing) { existing.remove(); customQuickFindInput = null; }
    }
    lastObjectName = objectName;
    try {
      const originalQuickFind = await getOriginalQuickFind();
      console.log("Found original Quick Find.");
      await waitForElement("table tbody");
      const container = document.querySelector(".scroller.uiScroller.scroller-wrapper.scroll-bidirectional.native");
      if (container) {
        await autoScrollAndWait(container);
        console.log("Auto scrolling finished.");
      }
      setupCustomQuickFind(originalQuickFind);
      processPicklistRows();
      const tableBody = document.querySelector("table tbody");
      if (tableBody) {
        const observer = new MutationObserver(mutations => {
          if (mutations.some(m => m.addedNodes.length)) processPicklistRows();
        });
        observer.observe(tableBody, { childList: true });
      }
      console.log("Initialization complete.");
    } catch (error) {
      console.error("Error during initialization:", error);
    }
  }

  // Listen for our custom navigation event
  window.addEventListener("location-changed", () => {
    console.log("location-changed event detected.");
    lastObjectName = null;
    setTimeout(initPicklistProcessing, 500);
  });

  // Also listen for background-sent navigation messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "location-changed") {
      console.log("Received location-changed from background.");
      lastObjectName = null;
      setTimeout(initPicklistProcessing, 500);
    }
  });

  await initPicklistProcessing();
  setTimeout(() => {
    if (!customQuickFindInput) {
      console.warn("Quick Find not initialized; adding fallback.");
      addFallbackButton();
    }
  }, 3000);
})();
