/**
* @File Name : content.js
* @Description : Handles UI modifications, Quick Find customization, auto-scroll, picklist processing, and XLSX export functionality.
*               On the home page, a modal allows selection of objects to export.
*               On the detail (fields and relationships) page, an export button is added inline to export the current object.
*               Additionally, on detail pages a button is added to display a modal listing fields missing Description and/or Help Text.
* @Author : Dave Moudy
* @Last Modified By :
* @Last Modified On :
* @Modification Log :
*==============================================================================
* Ver | Date         | Author      | Modification
*==============================================================================
* 1.0 | February 16,2025 |            | Initial Version
* 1.1 | February 20,2025 | Dave Moudy | Placed export button next to Quick Find, used closest scrollable parent for autoscroll
* 1.2 | February 21,2025 | Dave Moudy | Added Missing Field Info modal on detail pages and adjusted button positioning
**/

// ---------------------
// Utility Functions
// ---------------------

// Wait for an element to appear in the DOM, up to a specified timeout.
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

// Find the closest scrollable parent of an element (used for autoscroll).
function findScrollableParent(el) {
  let parent = el.parentElement;
  while (parent && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

// Scroll a container until its content no longer grows in height.
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

// Extract the object name from the URL for detail pages
function getObjectNameFromURL() {
  const match = window.location.pathname.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

// Remove extraneous modules from Setup Home
function removeSetupHomeModules() {
  document.querySelectorAll("section.onesetupModule").forEach(module => module.remove());
}

// Check if we are on Object Manager home
function isObjectManagerHomePage() {
  return window.location.pathname.includes("/ObjectManager/home");
}

// ---------------------
// Quick Find Handling
// ---------------------

async function getOriginalQuickFind() {
  // Attempt to find the Quick Find container
  let container = document.querySelector(".objectManagerGlobalSearchBox");
  if (!container) {
    container = document.querySelector("div[role='search']");
  }
  if (!container) throw new Error("Quick Find container not found.");
  
  // Then find the search input
  const input = container.querySelector("input[type='search']");
  if (!input) throw new Error("Quick Find input not found.");
  return input;
}

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
  
  // Clone the input so we can manage the 'input' event
  const newInput = originalInput.cloneNode(true);
  newInput.id = "customQuickFind";
  newInput.dataset.customized = "true";
  // Allow the input to take available space on the left.
  newInput.style.flex = "1";
  originalInput.parentNode.replaceChild(newInput, originalInput);

  // Set up the parent container so buttons are appended to the right.
  const parent = newInput.parentNode;
  parent.style.display = "flex";
  parent.style.alignItems = "center";
  // Use flex-start so the input stays on the left.
  parent.style.justifyContent = "flex-start";
  
  newInput.addEventListener("input", onQuickFindInput);
  console.log("Custom Quick Find attached.");

  // If on a detail page, add inline buttons.
  if (!isObjectManagerHomePage()) {
    addInlineExportButton(parent);
    addMissingFieldInfoButton(parent);
  }
}

function addInlineExportButton(parentContainer) {
  if (document.getElementById("exportDetailXLSXButton")) return;
  
  const exportButton = document.createElement("button");
  exportButton.id = "exportDetailXLSXButton";
  exportButton.textContent = "Export XLSX";
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
  exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
  parentContainer.appendChild(exportButton);
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
    
    row.style.display = (query === "" || 
                         combined.includes(query) || 
                         apiName.includes(query) || 
                         fieldType.includes(query))
      ? ""
      : "none";
  });
}

function addFallbackButton() {
  if (document.getElementById("initializeQuickFindButton")) return;
  
  const container = document.querySelector(".objectManagerGlobalSearchBox") 
                 || document.querySelector("div[role='search']");
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

// ---------------------
// Picklist & Export
// ---------------------

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
        const customQF = document.getElementById("customQuickFind");
        if (customQF) {
          onQuickFindInput({ target: { value: customQF.value } });
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

// Helper to ensure unique sheet names in XLSX
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

// Spinner
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

// ---------------------
// Export Routines
// ---------------------

// 1) Export fields of current object
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

// 2) Export all objects from the home page
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
        const match = link.href.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
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

// 3) Export only selected objects (used by the modal)
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

// ---------------------
// Modal for selecting objects to export
// ---------------------
async function showExportSelectionModal() {
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    const objects = [];
    rows.forEach(row => {
      const link = row.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
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
    modal.style.cssText = `
      position: fixed; 
      top: 0; 
      left: 0; 
      width: 100%; 
      height: 100%; 
      background: rgba(0,0,0,0.5); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      z-index: 10000;
    `;
    
    const container = document.createElement("div");
    container.style.cssText = `
      background: white; 
      padding: 20px; 
      border-radius: 5px; 
      max-height: 80%; 
      overflow-y: auto; 
      width: 300px;
    `;
    
    const title = document.createElement("h2");
    title.innerText = "Select Objects to Export";
    container.appendChild(title);
    
    // Header with toggle, Export Selected, and Cancel
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
    
    // Search filter
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search objects...";
    searchInput.style.cssText = `
      width: 100%; 
      padding: 5px; 
      margin-bottom: 10px; 
      border: 1px solid #ccc; 
      border-radius: 4px;
    `;
    searchInput.addEventListener("input", () => {
      const filter = searchInput.value.trim().toLowerCase();
      const labels = container.querySelectorAll("label");
      labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        label.style.display = text.includes(filter) ? "block" : "none";
      });
    });
    container.appendChild(searchInput);
    
    // List objects with checkboxes
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
    
    // Bottom Export Selected
    const bottomExportBtn = document.createElement("button");
    bottomExportBtn.innerText = "Export Selected";
    bottomExportBtn.style.cssText = `
      margin-top: 10px; 
      padding: 5px 10px; 
      background: #0070d2; 
      color: white; 
      border: none; 
      border-radius: 4px; 
      cursor: pointer; 
      width: 100%;
    `;
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

// ---------------------
// New Functionality: Missing Field Info Modal
// ---------------------

// Build a mapping of field labels to their IDs by scanning existing edit links on the page.
function getFieldIdMapping() {
  const mapping = {};
  // Look for anchor elements with href matching the pattern for field edit pages.
  const anchors = document.querySelectorAll('a[href*="/FieldsAndRelationships/"]');
  anchors.forEach(anchor => {
    const match = anchor.href.match(/\/FieldsAndRelationships\/([^\/]+)\/edit/);
    if (match && match[1]) {
      const fieldId = match[1];
      const label = anchor.textContent.trim();
      if (label) {
        mapping[label] = fieldId;
      }
    }
  });
  return mapping;
}

// Create and display the modal listing fields missing Description or Help Text.
function showMissingFieldsModal(fields, objectApiName) {
  // Create an overlay
  const overlay = document.createElement("div");
  overlay.id = "missing-fields-modal-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.zIndex = "10000";
  overlay.style.display = "flex";
  overlay.style.justifyContent = "center";
  overlay.style.alignItems = "center";

  // Create the modal container
  const modal = document.createElement("div");
  modal.id = "missing-fields-modal";
  modal.style.backgroundColor = "#fff";
  modal.style.padding = "20px";
  modal.style.borderRadius = "5px";
  modal.style.maxWidth = "600px";
  modal.style.maxHeight = "80%";
  modal.style.overflowY = "auto";
  modal.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
  modal.style.position = "relative";

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.style.position = "absolute";
  closeBtn.style.top = "10px";
  closeBtn.style.right = "10px";
  closeBtn.style.cursor = "pointer";
  closeBtn.addEventListener("click", () => {
    document.body.removeChild(overlay);
  });
  modal.appendChild(closeBtn);

  // Title for the modal
  const title = document.createElement("h2");
  title.textContent = "Fields Missing Description or Help Text";
  title.style.marginTop = "0";
  modal.appendChild(title);

  // Get mapping from field label to field ID (if available)
  const fieldIdMapping = getFieldIdMapping();

  if (fields.length === 0) {
    const noFieldsMsg = document.createElement("p");
    noFieldsMsg.textContent = "All fields have both Description and Help Text.";
    modal.appendChild(noFieldsMsg);
  } else {
    const list = document.createElement("ul");
    fields.forEach(field => {
      const listItem = document.createElement("li");
      listItem.style.marginBottom = "8px";

      // Check if we have an edit link (based on field label mapping)
      const fieldId = fieldIdMapping[field.fieldLabel];
      if (fieldId) {
        const link = document.createElement("a");
        link.href = `${window.location.origin}/lightning/setup/ObjectManager/${objectApiName}/FieldsAndRelationships/${fieldId}/edit`;
        link.textContent = field.fieldLabel;
        link.target = "_blank";
        link.style.textDecoration = "underline";
        link.style.color = "#0070d2";
        listItem.appendChild(link);
      } else {
        const span = document.createElement("span");
        span.textContent = field.fieldLabel;
        listItem.appendChild(span);
      }

      // Indicate which info is missing
      const missingInfo = [];
      if (!field.description || !field.description.trim()) missingInfo.push("Description");
      if (!field.inlineHelpText || !field.inlineHelpText.trim()) missingInfo.push("Help Text");

      const infoSpan = document.createElement("span");
      infoSpan.style.marginLeft = "10px";
      infoSpan.style.color = "red";
      infoSpan.textContent = ` (Missing: ${missingInfo.join(", ")})`;
      listItem.appendChild(infoSpan);

      list.appendChild(listItem);
    });
    modal.appendChild(list);
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// When the Missing Field Info button is clicked, fetch field describe and show modal.
function checkMissingFieldInfo() {
  const objectApiName = getObjectNameFromURL();
  if (!objectApiName) {
    alert("Could not determine Object API Name from URL.");
    return;
  }
  chrome.runtime.sendMessage(
    { type: "fetchObjectDescribe", objectApiName, origin: window.location.origin },
    response => {
      if (!response.success) {
        alert("Error fetching object details: " + response.error);
        return;
      }
      // Filter fields missing Description or Help Text.
      // Note: This assumes the describe response includes 'description' and 'inlineHelpText' properties.
      const missingFields = response.fields.filter(field =>
        (!field.description || !field.description.trim()) ||
        (!field.inlineHelpText || !field.inlineHelpText.trim())
      );
      showMissingFieldsModal(missingFields, objectApiName);
    }
  );
}

// Add the Missing Field Info button to the UI on detail pages.
function addMissingFieldInfoButton(parentContainer) {
  if (document.getElementById("missingFieldInfoButton")) return;
  
  const btn = document.createElement("button");
  btn.id = "missingFieldInfoButton";
  btn.textContent = "Check Missing Field Info";
  btn.style.cssText = `
    background-color: #0070d2;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 14px;
    cursor: pointer;
    margin-left: 10px;
  `;
  btn.addEventListener("click", checkMissingFieldInfo);
  parentContainer.appendChild(btn);
}

// ---------------------
// Main Flow
// ---------------------

function exportXLSX() {
  if (isObjectManagerHomePage()) {
    showExportSelectionModal();
  } else {
    exportCurrentObjectFieldsToXLSX();
  }
}

let lastObjectName = null;

function initPicklistProcessing() {
  // Only run on Setup pages
  if (!window.location.pathname.includes("/lightning/setup/")) return;
  
  // Home Page
  if (isObjectManagerHomePage()) {
    (async () => {
      try {
        // Wait for the object list container
        const tableBody = await waitForElement("table tbody");
        const scrollable = findScrollableParent(tableBody);
        if (scrollable) {
          await autoScrollAndWait(scrollable);
          console.log("Auto scrolling finished for home page.");
        }
        // Setup Quick Find
        const container = await waitForElement(".objectManagerGlobalSearchBox, div[role='search']");
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.justifyContent = "flex-start";
        let input = container.querySelector("input[type='search']");
        if (input) {
          setupCustomQuickFind(input);
        }
        // Add the "Select Objects to Export" button if needed
        if (!document.getElementById("exportSelectionButton")) {
          const selectionButton = document.createElement("button");
          selectionButton.id = "exportSelectionButton";
          selectionButton.textContent = "Select Objects to Export";
          selectionButton.style.cssText = `
            background-color: #0070d2; 
            color: white; 
            border: none; 
            border-radius: 4px; 
            padding: 5px 10px; 
            font-size: 14px; 
            cursor: pointer; 
            margin-left: 10px;
          `;
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
  
  // Detail Page (Fields & Relationships)
  removeSetupHomeModules();
  const objectName = getObjectNameFromURL();
  if (lastObjectName && lastObjectName !== objectName) {
    const existing = document.getElementById("customQuickFind");
    if (existing) existing.remove();
  }
  lastObjectName = objectName;
  
  (async () => {
    let originalQuickFind;
    try {
      originalQuickFind = await getOriginalQuickFind();
      console.log("Found original Quick Find.");
    } catch (error) {
      console.warn("Quick Find not found, will use fallback if on FieldsAndRelationships page.");
    }
    try {
      // Wait for the table, then find a scrollable parent
      const tableBody = await waitForElement("table tbody");
      const scrollable = findScrollableParent(tableBody);
      if (scrollable) {
        await autoScrollAndWait(scrollable);
        console.log("Auto scrolling finished on detail page.");
      }
      
      // If Quick Find is present, set it up. Otherwise, fallback only if we're on FieldsAndRelationships
      if (originalQuickFind) {
        setupCustomQuickFind(originalQuickFind);
      } else if (window.location.pathname.includes("FieldsAndRelationships")) {
        // Fallback: place a normal button (not fixed in top-right) in a header or near the table
        if (!document.getElementById("exportDetailXLSXButton")) {
          const fallbackContainer = document.querySelector(".objectManagerGlobalSearchBox, div[role='search']") 
                                || document.querySelector(".setupHeader, .header") 
                                || document.body;
          const exportButton = document.createElement("button");
          exportButton.id = "exportDetailXLSXButton";
          exportButton.textContent = "Export XLSX";
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
          exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
          fallbackContainer.appendChild(exportButton);
        }
      }
      
      // Process picklist rows
      processPicklistRows();
      
      // Watch for new rows added dynamically
      const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes.length)) {
          processPicklistRows();
        }
      });
      observer.observe(tableBody, { childList: true });
      
      console.log("Detail page initialization complete.");
    } catch (error) {
      console.error("Error during detail page initialization:", error);
    }
  })();
}

// Listen for location-changed from background
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

// Initialize
initPicklistProcessing().catch(console.error);

// If Quick Find is never found, add a fallback button
setTimeout(() => {
  if (!document.getElementById("customQuickFind")) {
    console.warn("Quick Find not initialized; adding fallback button.");
    addFallbackButton();
  }
}, 3000);
