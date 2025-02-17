/**
* @File Name : content.js
* @Description : Handles UI modifications, Quick Find customization, auto-scroll, picklist processing, and XLSX export functionality.
*               On the home page, a modal allows selection of objects to export.
*               On the detail (fields and relationships) page, an export button is added inline to export the current object.
* @Author : Dave Moudy
* @Last Modified By :
* @Last Modified On :
* @Modification Log :
*==============================================================================
* Ver | Date         | Author    | Modification
*==============================================================================
* 1.0 | February 16,2025 |         | Initial Version
* 1.1 | February 17,2025 |         | Fixed null parent error in setupCustomQuickFind
* 1.2 | February 17,2025 |         | Added export selection modal for home page
* 1.3 | February 17,2025 |         | Simplified modal to a single toggle button
* 1.4 | February 17,2025 |         | Positioned export button inline to the right of Quick Find box on home page
* 1.5 | February 17,2025 |         | Added export button on detail page (fields and relationships)
* 1.6 | February 17,2025 |         | Added a Cancel button next to the toggle in the export modal header
* 1.7 | February 17,2025 |         | Added an Export Selected button in the header so users can export without scrolling
* 1.8 | February 18,2025 |         | Added a search filter to the export selection modal for faster filtering
**/

// Utility Functions
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

// Adds a custom Quick Find input and, on detail pages, an inline export button.
function setupCustomQuickFind(originalInput) {
  if (!originalInput) {
    console.error("Original Quick Find input not found.");
    return;
  }
  if (!originalInput.parentNode) {
    console.error("Original Quick Find input has no parent node.");
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

  // Ensure the parent container is styled inline with the Quick Find box
  const parent = newInput.parentNode;
  parent.style.display = "flex";
  parent.style.justifyContent = "flex-end";
  parent.style.alignItems = "center";
  
  newInput.addEventListener("input", onQuickFindInput);
  console.log("Custom Quick Find attached.");

  // On detail pages, add an export button inline (if not on the home page)
  if (!isObjectManagerHomePage() && !document.getElementById("exportDetailXLSXButton")) {
    const exportButton = document.createElement("button");
    exportButton.id = "exportDetailXLSXButton";
    exportButton.textContent = "Export XLSX";
    exportButton.style.cssText = "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
    exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
    parent.appendChild(exportButton);
  }
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
        if (document.getElementById("customQuickFind")) {
          onQuickFindInput({ target: { value: document.getElementById("customQuickFind").value } });
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
  fallbackBtn.style.cssText = "background-color: #ff6f61; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
  fallbackBtn.addEventListener("click", () => window.location.reload(true));
  container.appendChild(fallbackBtn);
}

// Helper function to generate unique sheet names
function getUniqueSheetName(sheetName, existingNames) {
  let uniqueName = sheetName;
  let suffix = 1;
  while (existingNames.includes(uniqueName)) {
    const base = sheetName.substring(0, 31 - suffix.toString().length);
    uniqueName = base + suffix;
    suffix++;
  }
  return uniqueName;
}

// Spinner Functions
function showSpinner() {
  if (document.getElementById("exportSpinner")) return;
  const spinner = document.createElement("div");
  spinner.id = "exportSpinner";
  spinner.style.cssText = "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999;";
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

// Export Functions
function isObjectManagerHomePage() {
  return window.location.pathname.includes("/ObjectManager/home");
}

// Exports the fields of the current object (detail page) to XLSX
async function exportCurrentObjectFieldsToXLSX() {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = tableBody.querySelectorAll("tr");
    let data = [];
    data.push(["Field Label", "API Name", "Field Type", "Picklist Values"]);
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;
      const fieldLabel = cells[0].innerText.trim();
      const apiName = cells[1].innerText.trim();
      const fieldType = cells[2].innerText.trim();
      const picklistText = row.dataset.picklistText ? row.dataset.picklistText.trim() : "";
      data.push([fieldLabel, apiName, fieldType, picklistText]);
    });
    let wb = XLSX.utils.book_new();
    const objectName = getObjectNameFromURL() || "Object";
    let sheetName = objectName.length > 31 ? objectName.substring(0, 31) : objectName;
    let ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${objectName}_fields_export.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting current object fields to XLSX:", error);
  } finally {
    hideSpinner();
  }
}

// Export full database: each object gets its own worksheet
async function exportFullDatabaseToXLSX() {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    if (rows.length === 0) {
      console.error("No objects found on the home page.");
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
    
    let wb = XLSX.utils.book_new();
    const usedSheetNames = [];
    
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
      let data = [];
      data.push(["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values"]);
      if (response && response.success && response.fields) {
        response.fields.forEach(field => {
          data.push([
            field.fieldLabel,
            field.fieldApiName,
            field.fieldType,
            field.fieldLength,
            field.picklistValues
          ]);
        });
      } else {
        data.push([obj.objectLabel, obj.objectApiName, "Error fetching fields", "", ""]);
      }
      
      let sheetName = obj.objectLabel;
      sheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
      sheetName = getUniqueSheetName(sheetName, usedSheetNames);
      usedSheetNames.push(sheetName);
      
      let ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salesforce_objects_fields_export.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting full database to XLSX:", error);
  } finally {
    hideSpinner();
  }
}

// Export selected objects as XLSX
async function exportSelectedObjectsToXLSX(selectedObjects) {
  showSpinner();
  try {
    let wb = XLSX.utils.book_new();
    const usedSheetNames = [];
    for (const obj of selectedObjects) {
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
      let data = [];
      data.push(["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values"]);
      if (response && response.success && response.fields) {
        response.fields.forEach(field => {
          data.push([field.fieldLabel, field.fieldApiName, field.fieldType, field.fieldLength, field.picklistValues]);
        });
      } else {
        data.push([obj.objectLabel, obj.objectApiName, "Error fetching fields", "", ""]);
      }
      let sheetName = obj.objectLabel;
      sheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
      sheetName = getUniqueSheetName(sheetName, usedSheetNames);
      usedSheetNames.push(sheetName);
      let ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "selected_salesforce_objects_fields_export.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting selected objects to XLSX:", error);
  } finally {
    hideSpinner();
  }
}

// Modal to select objects to export with a header containing a toggle, Export Selected, Cancel button, and a search filter
async function showExportSelectionModal() {
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
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
    // Create modal overlay
    const modal = document.createElement("div");
    modal.id = "exportSelectionModal";
    modal.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;";
    
    const container = document.createElement("div");
    container.style.cssText = "background: white; padding: 20px; border-radius: 5px; max-height: 80%; overflow-y: auto; width: 300px;";
    
    const title = document.createElement("h2");
    title.innerText = "Select Objects to Export";
    container.appendChild(title);
    
    // Header container with toggle, Export Selected, and Cancel buttons
    const headerContainer = document.createElement("div");
    headerContainer.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 10px;";
    
    const toggleBtn = document.createElement("button");
    toggleBtn.innerText = "Select All";
    toggleBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    toggleBtn.addEventListener("click", () => {
      const checkboxes = container.querySelectorAll("label > input[type='checkbox']");
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
      toggleBtn.innerText = allChecked ? "Select All" : "Deselect All";
    });
    
    const headerExportBtn = document.createElement("button");
    headerExportBtn.innerText = "Export Selected";
    headerExportBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    headerExportBtn.addEventListener("click", async () => {
      const selectedCheckboxes = container.querySelectorAll("label > input[type='checkbox']:checked");
      const selectedObjects = [];
      selectedCheckboxes.forEach(cb => {
        const apiName = cb.value;
        const correspondingObj = objects.find(o => o.objectApiName === apiName);
        if (correspondingObj) {
          selectedObjects.push(correspondingObj);
        }
      });
      document.body.removeChild(modal);
      await exportSelectedObjectsToXLSX(selectedObjects);
    });
    
    const headerCancelBtn = document.createElement("button");
    headerCancelBtn.innerText = "Cancel";
    headerCancelBtn.style.cssText = "padding: 5px; background: #aaa; color: white; border: none; border-radius: 4px; cursor: pointer;";
    headerCancelBtn.addEventListener("click", () => {
      document.body.removeChild(modal);
    });
    
    headerContainer.appendChild(toggleBtn);
    headerContainer.appendChild(headerExportBtn);
    headerContainer.appendChild(headerCancelBtn);
    container.appendChild(headerContainer);
    
    // Search filter input for objects
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search objects...";
    searchInput.style.cssText = "width: 100%; padding: 5px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;";
    searchInput.addEventListener("input", () => {
      const filter = searchInput.value.trim().toLowerCase();
      const labels = container.querySelectorAll("label");
      labels.forEach(label => {
        // Skip header labels (if any) by checking if the label contains an input checkbox
        const text = label.textContent.toLowerCase();
        if (text.indexOf(filter) > -1) {
          label.style.display = "block";
        } else {
          label.style.display = "none";
        }
      });
    });
    container.appendChild(searchInput);
    
    // List objects with checkboxes (initially all unchecked)
    objects.forEach(obj => {
      const label = document.createElement("label");
      label.style.display = "block";
      label.style.marginBottom = "5px";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = obj.objectApiName;
      checkbox.checked = false;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + obj.objectLabel));
      container.appendChild(label);
    });
    
    // Also add a bottom Export Selected button (optional)
    const bottomExportBtn = document.createElement("button");
    bottomExportBtn.innerText = "Export Selected";
    bottomExportBtn.style.cssText = "margin-top: 10px; padding: 5px 10px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;";
    bottomExportBtn.addEventListener("click", async () => {
      const selectedCheckboxes = container.querySelectorAll("label > input[type='checkbox']:checked");
      const selectedObjects = [];
      selectedCheckboxes.forEach(cb => {
        const apiName = cb.value;
        const correspondingObj = objects.find(o => o.objectApiName === apiName);
        if (correspondingObj) {
          selectedObjects.push(correspondingObj);
        }
      });
      document.body.removeChild(modal);
      await exportSelectedObjectsToXLSX(selectedObjects);
    });
    container.appendChild(bottomExportBtn);
    
    modal.appendChild(container);
    document.body.appendChild(modal);
  } catch (error) {
    console.error("Error showing export selection modal:", error);
  }
}

// Main export function
function exportXLSX() {
  if (isObjectManagerHomePage()) {
    // For home page, show the modal for selection
    showExportSelectionModal();
  } else {
    exportCurrentObjectFieldsToXLSX();
  }
}

// Main Initialization
let lastObjectName = null;
function initPicklistProcessing() {
  if (!window.location.pathname.includes("/lightning/setup/")) return;
  
  if (isObjectManagerHomePage()) {
    (async () => {
      try {
        const scrollContainer = document.querySelector(".forceVirtualList, .slds-scrollable_y, .scroller.uiScroller");
        if (scrollContainer) {
          await autoScrollAndWait(scrollContainer);
          console.log("Auto scrolling finished for home page.");
        }
        const container = await waitForElement(".objectManagerGlobalSearchBox");
        // Ensure container is styled as flex so buttons align to the right
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.justifyContent = "flex-end";
        let input = container.querySelector("input[type='search']");
        if (input) {
          setupCustomQuickFind(input);
        }
        // Add the button for selection modal if not present
        if (!document.getElementById("exportSelectionButton")) {
          const selectionButton = document.createElement("button");
          selectionButton.id = "exportSelectionButton";
          selectionButton.textContent = "Select Objects to Export";
          selectionButton.style.cssText = "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
          selectionButton.addEventListener("click", showExportSelectionModal);
          container.appendChild(selectionButton);
        }
        console.log("Home page initialization complete.");
      } catch (error) {
        console.error("Error during home page initialization:", error);
      }
    })();
    return;
  }
  
  // Detail page initialization (fields and relationships)
  removeSetupHomeModules();
  const objectName = getObjectNameFromURL();
  if (lastObjectName && lastObjectName !== objectName) {
    const existing = document.getElementById("customQuickFind");
    if (existing) {
      existing.remove();
    }
  }
  lastObjectName = objectName;
  (async () => {
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
  })();
}

window.addEventListener("location-changed", () => {
  console.log("location-changed event detected.");
  lastObjectName = null;
  setTimeout(initPicklistProcessing, 500);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "location-changed") {
    console.log("Received location-changed from background.");
    lastObjectName = null;
    setTimeout(initPicklistProcessing, 500);
  }
});

initPicklistProcessing().catch(console.error);
setTimeout(() => {
  if (!document.getElementById("customQuickFind")) {
    console.warn("Quick Find not initialized; adding fallback.");
    addFallbackButton();
  }
}, 3000);
