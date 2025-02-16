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

window.addEventListener("popstate", () => window.dispatchEvent(new Event("location-changed")));
document.addEventListener("aura:locationChange", () => window.dispatchEvent(new Event("location-changed")));
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    window.dispatchEvent(new Event("location-changed"));
  }
}, 500);

let lastObjectName = null;
let customQuickFindInput = null;

// --- Utility Functions ---
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

 // Ensure the parent container of the input and the button is a flex container
 const parent = newInput.parentNode;
 parent.style.display = "flex"; // Make the parent a flex container
 parent.style.justifyContent = "flex-end"; // Align children (including button) to the right
 parent.style.alignItems = "center"; // Vertically center items, optional
 
 // Always add the Export CSV button if not present
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
 margin-left: auto; /* Aligns button to the right */
 `;
 exportButton.addEventListener("click", exportCSV);
 
 // Insert button near the "New" button or after the input element
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
    row.style.display = (query === "" || combined.includes(query) || apiName.includes(query) || fieldType.includes(query))
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

// --- Spinner Functions ---
function showSpinner() {
  if (document.getElementById("exportSpinner")) return;
  const spinner = document.createElement("div");
  spinner.id = "exportSpinner";
  spinner.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9999;
  `;
  spinner.innerHTML = `<div class="spinner"></div>`;
  document.body.appendChild(spinner);
  if (!document.getElementById("spinnerStyles")) {
    const style = document.createElement("style");
    style.id = "spinnerStyles";
    style.textContent = `
      .spinner {
        border: 12px solid #f3f3f3;
        border-top: 12px solid #0070d2;
        border-radius: 50%;
        width: 60px;
        height: 60px;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

function hideSpinner() {
  const spinner = document.getElementById("exportSpinner");
  if (spinner) spinner.remove();
}

// --- Export Functions ---
function isObjectManagerHomePage() {
  return window.location.pathname.includes("/ObjectManager/home");
}

// Export for a single object's fields (detail page)
async function exportCurrentObjectFields() {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = tableBody.querySelectorAll("tr");
    let csvContent = "Field Label,API Name,Field Type,Field Values\n";
    const escapeCSV = text =>
      (text.includes(",") || text.includes('"') || text.includes("\n"))
        ? `"${text.replace(/"/g, '""')}"`
        : text;
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;
      const fieldLabel = cells[0].innerText.trim();
      const apiName = cells[1].innerText.trim();
      const fieldType = cells[2].innerText.trim();
      const picklistText = row.dataset.picklistText ? row.dataset.picklistText.trim() : "";
      csvContent += `${escapeCSV(fieldLabel)},${escapeCSV(apiName)},${escapeCSV(fieldType)},${escapeCSV(picklistText)}\n`;
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salesforce_fields_export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting current object fields:", error);
  } finally {
    hideSpinner();
  }
}

// Export full database: iterate over all objects on the homepage and fetch their field details.
async function exportFullDatabase() {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    if (rows.length === 0) {
      console.error("No objects found on the homepage.");
      return;
    }
    const objects = [];
    rows.forEach(row => {
      const link = row.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/ObjectManager\/([^\/]+)/);
        if (match && match[1]) {
          const objectApiName = decodeURIComponent(match[1]);
          const objectLabel = row.querySelector("td")
            ? row.querySelector("td").innerText.trim()
            : objectApiName;
          objects.push({ objectLabel, objectApiName });
        }
      }
    });
    // Header now includes Field Size.
    let csvContent = "Object Label,Object API Name,Field Label,Field API Name,Field Type,Field Size,Picklist Values\n";
    for (const obj of objects) {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          {
            type: "fetchObjectDescribe",
            objectApiName: obj.objectApiName,
            origin: window.location.origin
          },
          resolve
        );
      });
      if (response && response.success && response.fields) {
        response.fields.forEach(field => {
          const escapeCSV = text =>
            ("" + text).includes(",") || ("" + text).includes('"') || ("" + text).includes("\n")
              ? `"${("" + text).replace(/"/g, '""')}"`
              : text;
          csvContent += `${escapeCSV(obj.objectLabel)},${escapeCSV(obj.objectApiName)},${escapeCSV(field.fieldLabel)},${escapeCSV(field.fieldApiName)},${escapeCSV(field.fieldType)},${escapeCSV(field.fieldLength)},${escapeCSV(field.picklistValues)}\n`;
        });
      } else {
        csvContent += `${obj.objectLabel},${obj.objectApiName},Error fetching fields,,,,\n`;
      }
    }
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salesforce_objects_fields_export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting full database:", error);
  } finally {
    hideSpinner();
  }
}

// Main export function chooses mode based on page.
function exportCSV() {
  if (isObjectManagerHomePage()) {
    exportFullDatabase();
  } else {
    exportCurrentObjectFields();
  }
}

// --- Main Initialization ---
async function initPicklistProcessing() {
  // Only run on Lightning Setup pages.
  if (!window.location.pathname.includes("/lightning/setup/")) return;
  
  if (isObjectManagerHomePage()) {
    try {
      // Auto-scroll the homepage to load all objects.
      const scrollContainer = document.querySelector(".forceVirtualList, .slds-scrollable_y, .scroller.uiScroller");
      if (scrollContainer) {
        await autoScrollAndWait(scrollContainer);
        console.log("Auto scrolling finished for homepage.");
      }
      // Attach export button via the Quick Find container if available.
      const container = await waitForElement(".objectManagerGlobalSearchBox");
      let input = container.querySelector("input[type='search']");
      if (input) {
        setupCustomQuickFind(input);
      } else if (!document.getElementById("exportCsvButton")) {
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
        container.appendChild(exportButton);
      }
      console.log("Homepage initialization complete.");
    } catch (error) {
      console.error("Error during homepage initialization:", error);
    }
    return;
  }

  // Detail pages: perform full initialization.
  removeSetupHomeModules();
  const objectName = getObjectNameFromURL();
  if (lastObjectName && lastObjectName !== objectName) {
    const existing = document.getElementById("customQuickFind");
    if (existing) {
      existing.remove();
      customQuickFindInput = null;
    }
  }
  lastObjectName = objectName;
  try {
    const originalQuickFind = await getOriginalQuickFind();
    console.log("Found original Quick Find.");
    await waitForElement("table tbody");
    const container = document.querySelector(".scroller.uiScroller.scroller-wrapper.scroll-bidirectional.native");
    if (container) {
      await autoScrollAndWait(container);
      console.log("Auto scrolling finished on detail page.");
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
    console.log("Detail page initialization complete.");
  } catch (error) {
    console.error("Error during detail page initialization:", error);
  }
}

// Listen for our custom navigation event.
window.addEventListener("location-changed", () => {
  console.log("location-changed event detected.");
  lastObjectName = null;
  setTimeout(initPicklistProcessing, 500);
});

// Also listen for background-sent navigation messages.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "location-changed") {
    console.log("Received location-changed from background.");
    lastObjectName = null;
    setTimeout(initPicklistProcessing, 500);
  }
});

// Always initialize on hard refresh.
initPicklistProcessing().catch(console.error);

// Fallback in case Quick Find isn’t set up.
setTimeout(() => {
  if (!customQuickFindInput) {
    console.warn("Quick Find not initialized; adding fallback.");
    addFallbackButton();
  }
}, 3000);
