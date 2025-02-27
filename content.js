// Helper to get the session cookie via a background message
async function getSessionCookie(origin, storeId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "getSessionCookie", origin, storeId }, response => {
      if (response && response.success) {
        resolve(response.cookieValue);
      } else {
        reject(response && response.error ? response.error : "No session cookie found");
      }
    });
  });
}

// Helper to get the correct Salesforce domain
function getMySalesforceDomain(origin) {
  if (origin.includes("lightning.force.com")) {
    return origin.replace("lightning.force.com", "my.salesforce.com");
  } else if (origin.includes("salesforce-setup.com")) {
    return origin.replace("salesforce-setup.com", "my.salesforce.com");
  }
  return origin;
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

function findScrollableParent(el) {
  let parent = el.parentElement;
  while (parent && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function autoScrollAndWait(container, delay = 500, stableIterations = 3, initialDelay = 1000) {
  return new Promise(resolve => {
    setTimeout(() => {
      let lastHeight = container.scrollHeight, stableCount = 0;
      function scrollStep() {
        container.scrollTop = container.scrollHeight;
        setTimeout(() => {
          const newHeight = container.scrollHeight;
          if (newHeight > lastHeight) { lastHeight = newHeight; stableCount = 0; }
          else { stableCount++; }
          if (stableCount >= stableIterations) resolve();
          else scrollStep();
        }, delay);
      }
      scrollStep();
    }, initialDelay);
  });
}

async function getObjectApiNameFromURL() {
  const match = window.location.pathname.match(/(?:ObjectManager|\/sObject\/)([^\/]+)/);
  let identifier = match && match[1] ? decodeURIComponent(match[1]) : null;
  if (!identifier) return null;

  if (/^[a-zA-Z0-9]{15,18}$/.test(identifier)) {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "fetchCustomObjectApiName", objectId: identifier, origin: window.location.origin }, resolve);
    });

    if (response && response.success) {
      window.customObjectId = identifier;
      return response.apiName;
    } else {
      console.error("Failed to fetch custom object API name:", response?.error || "Unknown error");
      return null;
    }
  }
  return identifier;
}

function removeSetupHomeModules() {
  document.querySelectorAll("section.onesetupModule").forEach(module => module.remove());
}

function isObjectManagerHomePage() {
  return window.location.pathname.includes("/ObjectManager/home");
}

async function exportCurrentObjectFieldsToXLSX() {
  showSpinner();
  try {
    const objectName = await getObjectApiNameFromURL();
    if (!objectName) throw new Error("Object name not determined.");

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "fetchObjectDescribe", objectApiName: objectName, origin: window.location.origin }, resolve);
    });

    let data = [["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values", "Formula", "Help", "Description"]];
    if (response && response.success && response.fields) {
      response.fields.forEach(field => {
        const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
        data.push([
          field.fieldLabel,
          field.fieldApiName,
          mappedFieldType,
          field.fieldLength || "",
          field.picklistValues,
          field.formula,
          field.helpText,
          field.description
        ]);
      });
    }

    let wb = XLSX.utils.book_new();
    const sheetName = objectName.length > 31 ? objectName.substring(0, 31) : objectName;
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
    console.error("Error exporting current object fields:", error);
  } finally {
    hideSpinner();
  }
}

async function exportFullDatabaseToXLSX(exportMode = "tabs") {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    if (rows.length === 0) {
      console.error("No objects found on the home page.");
      return;
    }

    const objects = [];
    for (const row of rows) {
      const link = row.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
        if (match && match[1]) {
          let identifier = decodeURIComponent(match[1]);
          let objectApiName = identifier;
          if (/^[a-zA-Z0-9]{15,18}$/.test(identifier)) {
            const response = await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: "fetchCustomObjectApiName", objectId: identifier, origin: window.location.origin }, resolve);
            });
            if (response && response.success) {
              objectApiName = response.apiName;
            } else {
              console.error("Failed to fetch API name for row:", response.error);
            }
          }
          const objectLabel = row.querySelector("td") ? row.querySelector("td").innerText.trim() : objectApiName;
          objects.push({ objectLabel, objectApiName });
        }
      }
    }

    let wb = XLSX.utils.book_new();
    if (exportMode === "tabs") {
      const usedSheetNames = [];
      for (const obj of objects) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "fetchObjectDescribe", objectApiName: obj.objectApiName, origin: window.location.origin }, resolve);
        });

        let data = [["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values", "Formula", "Help", "Description"]];
        if (response && response.success && response.fields) {
          response.fields.forEach(field => {
            const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
            data.push([
              field.fieldLabel,
              field.fieldApiName,
              mappedFieldType,
              field.fieldLength || "",
              field.picklistValues,
              field.formula,
              field.helpText,
              field.description
            ]);
          });
        } else {
          data.push([obj.objectLabel, obj.objectApiName, "Error fetching fields", "", "", "", "", ""]);
        }

        let sheetName = obj.objectLabel;
        sheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
        sheetName = getUniqueSheetName(sheetName, usedSheetNames);
        usedSheetNames.push(sheetName);

        let ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
    } else if (exportMode === "single") {
      let data = [["Object Label", "Field Label", "API Name", "Field Type", "Field Length", "Picklist Values", "Formula", "Help", "Description"]];
      for (const obj of objects) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "fetchObjectDescribe", objectApiName: obj.objectApiName, origin: window.location.origin }, resolve);
        });

        if (response && response.success && response.fields) {
          response.fields.forEach(field => {
            const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
            data.push([
              obj.objectLabel,
              field.fieldLabel,
              field.fieldApiName,
              mappedFieldType,
              field.fieldLength || "",
              field.picklistValues,
              field.formula,
              field.helpText,
              field.description
            ]);
          });
        } else {
          data.push([obj.objectLabel, "Error fetching fields", "", "", "", "", "", "", ""]);
        }
      }

      let ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Export");
    }

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = exportMode === "tabs" 
      ? "salesforce_objects_fields_export.xlsx" 
      : "salesforce_objects_fields_export_single_sheet.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting full database:", error);
  } finally {
    hideSpinner();
  }
}

async function exportSelectedObjectsToXLSX(selectedObjects, exportMode = "tabs") {
  showSpinner();
  try {
    let wb = XLSX.utils.book_new();
    if (exportMode === "tabs") {
      const usedSheetNames = [];
      for (const obj of selectedObjects) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "fetchObjectDescribe", objectApiName: obj.objectApiName, origin: window.location.origin }, resolve);
        });

        let data = [["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values", "Formula", "Help", "Description"]];
        if (response && response.success && response.fields) {
          response.fields.forEach(field => {
            const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
            data.push([
              field.fieldLabel,
              field.fieldApiName,
              mappedFieldType,
              field.fieldLength || "",
              field.picklistValues,
              field.formula,
              field.helpText,
              field.description
            ]);
          });
        } else {
          data.push([obj.objectLabel, obj.objectApiName, "Error fetching fields", "", "", "", "", ""]);
        }

        let sheetName = obj.objectLabel;
        sheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
        sheetName = getUniqueSheetName(sheetName, usedSheetNames);
        usedSheetNames.push(sheetName);

        let ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
    } else if (exportMode === "single") {
      let data = [["Object Label", "Field Label", "API Name", "Field Type", "Field Length", "Picklist Values", "Formula", "Help", "Description"]];
      for (const obj of selectedObjects) {
        const response = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "fetchObjectDescribe", objectApiName: obj.objectApiName, origin: window.location.origin }, resolve);
        });

        if (response && response.success && response.fields) {
          response.fields.forEach(field => {
            const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
            data.push([
              obj.objectLabel,
              field.fieldLabel,
              field.fieldApiName,
              mappedFieldType,
              field.fieldLength || "",
              field.picklistValues,
              field.formula,
              field.helpText,
              field.description
            ]);
          });
        } else {
          data.push([obj.objectLabel, "Error fetching fields", "", "", "", "", "", "", ""]);
        }
      }

      let ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Export");
    }

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = exportMode === "tabs" 
      ? "selected_salesforce_objects_fields_export.xlsx" 
      : "selected_salesforce_objects_fields_export_single_sheet.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting selected objects:", error);
  } finally {
    hideSpinner();
  }
}

async function getOriginalQuickFind() {
  let container = document.querySelector(".objectManagerGlobalSearchBox") || document.querySelector("div[role='search']");
  if (!container) throw new Error("Quick Find container not found.");
  const input = container.querySelector("input[type='search']");
  if (!input) throw new Error("Quick Find input not found.");
  return input;
}

function setupCustomQuickFind(originalInput) {
  if (!originalInput || !originalInput.parentNode) {
    console.error("Original Quick Find input issue.");
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
  newInput.parentNode.style.cssText = "display: flex; justify-content: flex-end; align-items: center;";
  newInput.addEventListener("input", onQuickFindInput);
  console.log("Custom Quick Find attached.");

  if (!isObjectManagerHomePage()) {
    addInlineExportButton(newInput.parentNode);
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

    row.style.display = (query === "" || combined.includes(query) || apiName.includes(query) || fieldType.includes(query)) ? "" : "none";
  });
}

function fetchPicklistValuesViaBackground(row, objectName, fieldApiName, isStandard) {
  const origin = window.location.origin;
  chrome.runtime.sendMessage(
    { type: "fetchPicklistValues", objectName, fieldApiName, origin, isStandard },
    response => {
      if (response && response.success) {
        const picklistText = response.data.picklistText || "";
        row.dataset.picklistText = picklistText;
        const labelCell = row.querySelector("td");
        if (labelCell) labelCell.setAttribute("title", picklistText);
        console.log(`Fetched picklist for ${fieldApiName}: ${picklistText}`);
        const customQF = document.getElementById("customQuickFind");
        if (customQF) onQuickFindInput({ target: { value: customQF.value } });
      } else {
        console.error("Error fetching picklist values:", response && response.error);
      }
    }
  );
}

async function processPicklistRows() {
  const tableBody = document.querySelector("table tbody");
  if (!tableBody) return;

  const objectName = await getObjectApiNameFromURL();
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

function getUniqueSheetName(sheetName, existingNames) {
  let uniqueName = sheetName, suffix = 1;
  while (existingNames.includes(uniqueName)) {
    const base = sheetName.substring(0, 31 - suffix.toString().length);
    uniqueName = base + suffix;
    suffix++;
  }
  return uniqueName;
}

function showSpinner() {
  if (document.getElementById("exportSpinner")) return;
  const spinner = document.createElement("div");
  spinner.id = "exportSpinner";
  spinner.style.cssText = "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999;";
  spinner.innerHTML = '<div class="spinner"></div>';
  document.body.appendChild(spinner);

  if (!document.getElementById("spinnerStyles")) {
    const style = document.createElement("style");
    style.id = "spinnerStyles";
    style.textContent = `
      .spinner { border: 12px solid #f3f3f3; border-top: 12px solid #0070d2; border-radius: 50%; width: 60px; height: 60px; animation: spin 1s linear infinite; }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }
}

function hideSpinner() {
  const spinner = document.getElementById("exportSpinner");
  if (spinner) spinner.remove();
}

function mapFieldTypeForExport(fieldType, fieldLength) {
  switch (fieldType.toLowerCase()) {
    case 'reference': return 'Lookup(User)';
    case 'double': return 'Number(4,0)';
    case 'string': return `Text(${fieldLength || 500})`;
    default: return fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
  }
}

function addInlineExportButton(parentContainer) {
  if (document.getElementById("exportDetailXLSXButton")) return;
  const exportButton = document.createElement("button");
  exportButton.id = "exportDetailXLSXButton";
  exportButton.textContent = "Export XLSX";
  exportButton.style.cssText = "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
  exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
  parentContainer.appendChild(exportButton);
}

async function showExportSelectionModal() {
  try {
    showSpinner();
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    const objects = [];

    for (const row of rows) {
      const link = row.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
        if (match && match[1]) {
          let identifier = decodeURIComponent(match[1]);
          let objectApiName = identifier;
          if (/^[a-zA-Z0-9]{15,18}$/.test(identifier)) {
            const response = await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: "fetchCustomObjectApiName", objectId: identifier, origin: window.location.origin }, resolve);
            });
            if (response && response.success) { objectApiName = response.apiName; }
            else console.error("Failed to fetch API name for modal:", response.error);
          }
          const objectLabel = row.querySelector("td") ? row.querySelector("td").innerText.trim() : objectApiName;
          objects.push({ objectLabel, objectApiName });
        }
      }
    }

    const modal = document.createElement("div");
    modal.id = "exportSelectionModal";
    modal.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;";

    const container = document.createElement("div");
    container.style.cssText = "background: white; padding: 20px; border-radius: 5px; max-height: 80%; overflow-y: auto; width: 300px;";

    const title = document.createElement("h2");
    title.innerText = "Select Objects to Export";
    container.appendChild(title);

    const topButtonContainer = document.createElement("div");
    topButtonContainer.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 10px;";

    const topExportBtn = document.createElement("button");
    topExportBtn.innerText = "Export Selected";
    topExportBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    topExportBtn.addEventListener("click", async () => {
      const exportMode = container.querySelector("input[name='exportMode']:checked").value;
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
      await exportSelectedObjectsToXLSX(selectedObjects, exportMode);
    });

    const topCloseBtn = document.createElement("button");
    topCloseBtn.innerText = "Close";
    topCloseBtn.style.cssText = "padding: 5px; background: #aaa; color: white; border: none; border-radius: 4px; cursor: pointer;";
    topCloseBtn.addEventListener("click", () => {
      document.body.removeChild(modal);
    });

    topButtonContainer.appendChild(topExportBtn);
    topButtonContainer.appendChild(topCloseBtn);
    container.appendChild(topButtonContainer);

    const selectionButtonsContainer = document.createElement("div");
    selectionButtonsContainer.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 10px;";

    const toggleFilteredBtn = document.createElement("button");
    toggleFilteredBtn.innerText = "Toggle Filtered";
    toggleFilteredBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    toggleFilteredBtn.addEventListener("click", () => {
      const checkboxes = Array.from(container.querySelectorAll("label > input[type='checkbox']"))
        .filter(cb => window.getComputedStyle(cb.parentElement).display !== "none");
      const allChecked = checkboxes.every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
    });

    const selectStandardBtn = document.createElement("button");
    selectStandardBtn.innerText = "Select Standard";
    selectStandardBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    selectStandardBtn.addEventListener("click", () => {
      const checkboxes = Array.from(container.querySelectorAll("label > input[type='checkbox']"))
        .filter(cb => window.getComputedStyle(cb.parentElement).display !== "none");
      checkboxes.forEach(cb => { cb.checked = !cb.value.endsWith("__c"); });
    });

    const selectCustomBtn = document.createElement("button");
    selectCustomBtn.innerText = "Select Custom";
    selectCustomBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    selectCustomBtn.addEventListener("click", () => {
      const checkboxes = Array.from(container.querySelectorAll("label > input[type='checkbox']"))
        .filter(cb => window.getComputedStyle(cb.parentElement).display !== "none");
      checkboxes.forEach(cb => { cb.checked = cb.value.endsWith("__c"); });
    });

    selectionButtonsContainer.appendChild(toggleFilteredBtn);
    selectionButtonsContainer.appendChild(selectStandardBtn);
    selectionButtonsContainer.appendChild(selectCustomBtn);
    container.appendChild(selectionButtonsContainer);

    const exportModeContainer = document.createElement("div");
    exportModeContainer.style.marginBottom = "10px";
    exportModeContainer.innerHTML = `
      <label><input type="radio" name="exportMode" value="tabs" checked> Separate Sheets</label>
      <label style="margin-left: 10px;"><input type="radio" name="exportMode" value="single"> Single Sheet</label>
    `;
    container.appendChild(exportModeContainer);

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search objects...";
    searchInput.style.cssText = "width: 100%; padding: 5px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;";
    searchInput.addEventListener("input", () => {
      const filter = searchInput.value.trim().toLowerCase();
      const labels = container.querySelectorAll("label");
      labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        label.style.display = text.includes(filter) ? "block" : "none";
      });
    });
    container.appendChild(searchInput);

    objects.forEach(obj => {
      const label = document.createElement("label");
      label.style.cssText = "display: block; margin-bottom: 5px;";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = obj.objectApiName;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + obj.objectLabel));
      container.appendChild(label);
    });

    const btnContainer = document.createElement("div");
    btnContainer.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 10px;";
    const headerExportBtn = document.createElement("button");
    headerExportBtn.innerText = "Export Selected";
    headerExportBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    headerExportBtn.addEventListener("click", async () => {
      const exportMode = container.querySelector("input[name='exportMode']:checked").value;
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
      await exportSelectedObjectsToXLSX(selectedObjects, exportMode);
    });

    const headerCancelBtn = document.createElement("button");
    headerCancelBtn.innerText = "Cancel";
    headerCancelBtn.style.cssText = "padding: 5px; background: #aaa; color: white; border: none; border-radius: 4px; cursor: pointer;";
    headerCancelBtn.addEventListener("click", () => {
      document.body.removeChild(modal);
    });
    btnContainer.appendChild(headerExportBtn);
    btnContainer.appendChild(headerCancelBtn);
    container.appendChild(btnContainer);

    modal.appendChild(container);
    hideSpinner();
    document.body.appendChild(modal);
  } catch (error) {
    console.error("Error showing export selection modal:", error);
    hideSpinner();
  }
}

function showBulkUpdateModal(fields) {
  const modal = document.createElement("div");
  modal.id = "bulkUpdateModal";
  modal.style.cssText = "position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;";

  const container = document.createElement("div");
  container.style.cssText = "background: white; padding: 20px; border-radius: 5px; max-height:80%; overflow-y: auto; width:700px;";

  const title = document.createElement("h2");
  title.innerText = "Bulk Update Custom Field Descriptions & Help Text";
  container.appendChild(title);

  const infoSection = document.createElement("div");
  infoSection.style.cssText = "margin: 10px 0; padding: 10px; border-radius: 4px; background-color: #e8f4f8; color: #0070d2;";
  infoSection.innerHTML = `<p><strong>Instructions:</strong> Update the description and help text for custom fields. Click "Save Changes" when done.</p>
    <p><strong>Note:</strong> Picklist, lookup, and master-detail fields now have a special update method to avoid metadata errors.</p>`;
  container.appendChild(infoSection);

  const statusArea = document.createElement("div");
  statusArea.id = "bulkUpdateStatus";
  statusArea.style.cssText = "margin: 10px 0; padding: 10px; border-radius: 4px; display: none;";
  container.appendChild(statusArea);

  const filterSection = document.createElement("div");
  filterSection.style.cssText = "margin: 10px 0; padding: 8px; background-color: #f5f5f5; border-radius: 4px;";
  const filterLabel = document.createElement("label");
  filterLabel.innerHTML = "<strong>Show Fields: </strong>";
  filterSection.appendChild(filterLabel);

  const allFilter = document.createElement("label");
  allFilter.style.cssText = "margin-right: 15px; cursor: pointer;";
  allFilter.innerHTML = `<input type="radio" name="fieldFilter" value="all" checked> All`;
  filterSection.appendChild(allFilter);

  const standardFilter = document.createElement("label");
  standardFilter.style.cssText = "margin-right: 15px; cursor: pointer;";
  standardFilter.innerHTML = `<input type="radio" name="fieldFilter" value="standard"> Text/Number`;
  filterSection.appendChild(standardFilter);

  const picklistFilter = document.createElement("label");
  picklistFilter.style.cssText = "margin-right: 15px; cursor: pointer;";
  picklistFilter.innerHTML = `<input type="radio" name="fieldFilter" value="picklist"> Picklist/Lookup`;
  filterSection.appendChild(picklistFilter);

  container.appendChild(filterSection);

  const headerRow = document.createElement("div");
  headerRow.style.cssText = "display: grid; grid-template-columns: 35% 32.5% 32.5%; margin-bottom: 10px; font-weight: bold; background-color: #f5f5f5; padding: 8px;";
  const fieldHeader = document.createElement("div");
  fieldHeader.innerText = "Field";
  const descHeader = document.createElement("div");
  descHeader.innerText = "Description";
  const helpHeader = document.createElement("div");
  helpHeader.innerText = "Help Text";
  headerRow.appendChild(fieldHeader);
  headerRow.appendChild(descHeader);
  headerRow.appendChild(helpHeader);
  container.appendChild(headerRow);

  const form = document.createElement("div");
  form.style.cssText = "max-height: 400px; overflow-y: auto; border: 1px solid #ccc;";

  // Add CSS for highlighting changed fields
  if (!document.getElementById("bulkUpdateStyles")) {
    const style = document.createElement("style");
    style.id = "bulkUpdateStyles";
    style.textContent = `
      .field-changed {
        background-color: #fff8e1 !important;
        border: 1px solid #ffd54f !important;
      }
    `;
    document.head.appendChild(style);
  }

  const getFieldCategory = (fieldType) => {
    const type = fieldType.toLowerCase();
    return ['picklist', 'multipicklist', 'lookup', 'reference', 'master-detail', 'hierarchyid'].includes(type) ? 'picklist' : 'standard';
  };

  fields.forEach(field => {
    const fieldCategory = getFieldCategory(field.fieldType);
    const fieldContainer = document.createElement("div");
    fieldContainer.dataset.fieldType = fieldCategory;
    fieldContainer.style.cssText = "display: grid; grid-template-columns: 35% 32.5% 32.5%; padding: 8px; border-bottom: 1px solid #eee;";

    const fieldInfo = document.createElement("div");
    const specialFieldIndicator = fieldCategory === 'picklist' ? 
      ' <span style="background-color: #fff3cd; color: #856404; font-size: 11px; padding: 2px 4px; border-radius: 3px;">Special&nbsp;Update</span>' : '';
    fieldInfo.innerHTML = `<strong>${field.fieldLabel}</strong>${specialFieldIndicator}<br>
      <span style="font-size: 12px; color: #666;">${field.fieldApiName}</span><br>
      <span style="font-size: 11px; color: #888;">${field.fieldType || ''}</span>`;
    fieldContainer.appendChild(fieldInfo);

    const descWrapper = document.createElement("div");
    const descInput = document.createElement("textarea");
    descInput.placeholder = "Description";
    descInput.value = field.currentDescription || "";
    descInput.dataset.originalValue = field.currentDescription || "";
    descInput.dataset.fieldId = field.fieldId;
    descInput.dataset.fieldType = "description";
    descInput.dataset.apiName = field.fieldApiName;
    descInput.dataset.category = fieldCategory;
    descInput.rows = 2;
    descInput.style.cssText = "width: 95%; resize: vertical;";
    
    // Add change detection event
    descInput.addEventListener('input', function() {
      if (this.value !== this.dataset.originalValue) {
        this.classList.add('field-changed');
      } else {
        this.classList.remove('field-changed');
      }
    });
    
    descWrapper.appendChild(descInput);
    fieldContainer.appendChild(descWrapper);

    const helpWrapper = document.createElement("div");
    const helpInput = document.createElement("textarea");
    helpInput.placeholder = "Help Text";
    helpInput.value = field.currentHelpText || "";
    helpInput.dataset.originalValue = field.currentHelpText || "";
    helpInput.dataset.fieldId = field.fieldId;
    helpInput.dataset.fieldType = "helpText";
    helpInput.dataset.apiName = field.fieldApiName;
    helpInput.dataset.category = fieldCategory;
    helpInput.rows = 2;
    helpInput.style.cssText = "width: 95%; resize: vertical;";
    
    // Add change detection event
    helpInput.addEventListener('input', function() {
      if (this.value !== this.dataset.originalValue) {
        this.classList.add('field-changed');
      } else {
        this.classList.remove('field-changed');
      }
    });
    
    helpWrapper.appendChild(helpInput);
    fieldContainer.appendChild(helpWrapper);

    form.appendChild(fieldContainer);
  });

  container.appendChild(form);

  const filterInputs = filterSection.querySelectorAll('input[name="fieldFilter"]');
  filterInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      const filterValue = e.target.value;
      const fieldContainers = form.querySelectorAll('div[data-field-type]');
      fieldContainers.forEach(container => {
        container.style.display = (filterValue === 'all' || container.dataset.fieldType === filterValue) ? 'grid' : 'none';
      });
    });
  });

  const btnContainer = document.createElement("div");
  btnContainer.style.cssText = "margin-top: 15px; display: flex; justify-content: space-between;";

  const infoText = document.createElement("div");
  infoText.innerHTML = `<span style="color: #666; font-size: 12px;">${fields.length} fields available for update</span>`;
  btnContainer.appendChild(infoText);

  const actionBtns = document.createElement("div");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.innerText = "Save Changes";
  saveBtn.style.cssText = "padding: 8px 15px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;";
  saveBtn.addEventListener("click", () => {
    statusArea.style.display = "block";
    statusArea.style.backgroundColor = "#f9f9f9";
    statusArea.style.color = "#333";
    statusArea.innerHTML = "Processing updates... This may take a moment.";
    saveBtn.disabled = true;
    saveBtn.innerText = "Saving...";

    const inputs = form.querySelectorAll("textarea");
    const updates = {};
    let changeCount = 0;

    inputs.forEach(input => {
      const fieldId = input.dataset.fieldId;
      const apiName = input.dataset.apiName;
      if (!updates[fieldId]) updates[fieldId] = {};

      if (input.dataset.fieldType === "description") {
        if (input.value !== input.dataset.originalValue) {
          updates[fieldId].Description = input.value;
          changeCount++;
          console.log(`Field ${apiName} description changed`);
        }
      } else if (input.dataset.fieldType === "helpText") {
        if (input.value !== input.dataset.originalValue) {
          updates[fieldId].InlineHelpText = input.value;
          changeCount++;
          console.log(`Field ${apiName} help text changed`);
        }
      }
    });

    if (changeCount === 0) {
      statusArea.style.backgroundColor = "#fff3cd";
      statusArea.style.color = "#856404";
      statusArea.innerHTML = "No changes detected. Make changes before saving.";
      saveBtn.disabled = false;
      saveBtn.innerText = "Save Changes";
      return;
    }

    statusArea.innerHTML = `Processing ${changeCount} field updates...`;
    console.log("Sending updates:", updates);

    const fieldNameMap = {};
    fields.forEach(field => {
      fieldNameMap[field.fieldId] = `${field.fieldLabel} (${field.fieldApiName})`;
    });

    chrome.runtime.sendMessage({ 
      type: "bulkUpdateFields", 
      updates, 
      fieldNameMap,  
      origin: window.location.origin 
    }, response => {
      console.log("Bulk update response:", response);
      if (response && response.success) {
        statusArea.style.backgroundColor = "#d4edda";
        statusArea.style.color = "#155724";
        statusArea.innerHTML = `Success! ${changeCount} fields updated.`;
        setTimeout(() => { modal.remove(); }, 2000);
      } else {
        saveBtn.disabled = false;
        saveBtn.innerText = "Try Again";
        statusArea.style.backgroundColor = "#f8d7da";
        statusArea.style.color = "#721c24";
        if (response && response.successCount > 0) {
          statusArea.innerHTML = `Partial success: ${response.successCount} fields updated, ${response.failureCount} failed.<br><br>
          <details style="margin-top: 10px;"><summary>View error details</summary>
          <div style="margin-top: 8px; font-size: 12px; max-height: 200px; overflow-y: auto;">${response.formattedErrorMessage || response.errorMessage || response.error}</div></details>`;
        } else if (response && (response.formattedErrorMessage || response.errorMessage)) {
          statusArea.innerHTML = `Error updating fields:<br><br>
          <div style="font-size: 12px; max-height: 200px; overflow-y: auto;">${response.formattedErrorMessage || response.errorMessage}</div>`;
        } else if (response && response.error) {
          statusArea.innerHTML = `Error updating fields: ${response.error}`;
        } else {
          statusArea.innerHTML = "Error updating fields. Check console for details.";
        }
      }
    });
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.innerText = "Cancel";
  cancelBtn.style.cssText = "padding: 8px 15px; background: #aaa; color: white; border: none; border-radius: 4px; cursor: pointer;";
  cancelBtn.addEventListener("click", () => modal.remove());

  actionBtns.appendChild(saveBtn);
  actionBtns.appendChild(cancelBtn);
  btnContainer.appendChild(actionBtns);
  container.appendChild(btnContainer);

  modal.appendChild(container);
  document.body.appendChild(modal);
}

function addBulkUpdateButton() {
  if (document.getElementById("bulkUpdateCustomFieldsButton")) return;
  const container = document.querySelector(".objectManagerGlobalSearchBox, div[role='search']") || document.body;
  const bulkBtn = document.createElement("button");
  bulkBtn.id = "bulkUpdateCustomFieldsButton";
  bulkBtn.textContent = "Bulk Update Custom Fields";
  bulkBtn.style.cssText = "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
  bulkBtn.addEventListener("click", openBulkUpdateModal);
  container.appendChild(bulkBtn);
}

async function openBulkUpdateModal() {
  showSpinner();
  try {
    const objectName = await getObjectApiNameFromURL();
    if (!objectName) {
      hideSpinner();
      alert("Object name not determined.");
      return;
    }

    let fieldDescriptions = {};
    try {
      const getDescriptions = async () => {
        const sessionId = await getSessionCookie(window.location.origin, null);
        if (!sessionId) {
          console.log("Failed to get session cookie");
          return;
        }

        const apiOrigin = window.location.origin.includes('lightning.force.com') 
          ? window.location.origin.replace('lightning.force.com', 'my.salesforce.com')
          : window.location.origin;

        const isCustomObject = objectName.endsWith('__c');
        let url;

        if (isCustomObject) {
          let objectId = window.customObjectId;
          if (!objectId) {
            const objResponse = await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: "getObjectId", objectApiName: objectName, origin: window.location.origin }, resolve);
            });
            if (objResponse?.success) {
              objectId = objResponse.objectId;
            }
          }
          if (objectId) {
            url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(
              `SELECT DeveloperName, Metadata, InlineHelpText FROM CustomField WHERE TableEnumOrId = '${objectId}'`
            )}`;
          }
        } else {
          url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(
            `SELECT QualifiedApiName, Description, InlineHelpText FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectName}'`
          )}`;
        }

        if (url) {
          const response = await fetch(url, {
            method: "GET",
            headers: { "Content-Type": "application/json", "Authorization": "Bearer " + sessionId }
          });

          if (response.ok) {
            const data = await response.json();
            if (data.records && data.records.length > 0) {
              data.records.forEach(record => {
                let fieldApiName;
                if (isCustomObject && record.DeveloperName) {
                  fieldApiName = record.DeveloperName + '__c';
                } else {
                  fieldApiName = record.QualifiedApiName || record.DeveloperName;
                }

                const description = (record.Metadata && record.Metadata.description !== undefined)
                  ? record.Metadata.description
                  : (record.Description || '');
                
                fieldDescriptions[fieldApiName] = { description, helpText: record.InlineHelpText || '' };
                console.log(`Set description for ${fieldApiName}: ${description}`);
              });
              console.log("Retrieved field descriptions:", fieldDescriptions);
            }
          } else {
            console.error("Failed to retrieve field descriptions", await response.text());
          }
        }
      };

      await getDescriptions();
    } catch (error) {
      console.error("Error getting field descriptions:", error);
    }

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "fetchObjectDescribe", objectApiName: objectName, origin: window.location.origin }, resolve);
    });

    if (response && response.success && response.fields) {
      const customFields = response.fields.filter(field => {
        const fieldType = field.fieldType.toLowerCase();
        return field.fieldApiName.endsWith("__c") && !["formula", "auto number", "rollup summary"].includes(fieldType);
      });

      if (customFields.length === 0) {
        hideSpinner();
        alert("No editable custom fields found for this object.");
        return;
      }

      const fieldsForModal = [];
      for (const field of customFields) {
        const fieldIdResponse = await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: "getCustomFieldId", objectApiName: objectName, fieldApiName: field.fieldApiName, origin: window.location.origin }, resolve);
        });

        if (fieldIdResponse && fieldIdResponse.success) {
          const descRes = await getCustomFieldDescription(field.fieldApiName, objectName, window.customObjectId, window.location.origin);
          const directDescription = descRes.success ? descRes.description : '';
          const directHelpText = descRes.success ? descRes.helpText : '';

          fieldsForModal.push({
            fieldId: fieldIdResponse.fieldId,
            fieldLabel: field.fieldLabel,
            fieldApiName: field.fieldApiName,
            fieldType: field.fieldType,
            currentDescription: directDescription || field.description || '',
            currentHelpText: directHelpText || field.helpText || ''
          });
        } else {
          console.error("Failed to get field Id for " + field.fieldApiName, fieldIdResponse?.error || "Unknown error");
        }
      }

      hideSpinner();
      if (fieldsForModal.length > 0) {
        showBulkUpdateModal(fieldsForModal);
      } else {
        alert("Unable to retrieve field IDs for custom fields. Please check the console for details.");
      }
    } else {
      hideSpinner();
      alert("Error fetching object describe: " + (response?.error || "Unknown error"));
    }
  } catch (error) {
    hideSpinner();
    console.error("Error in openBulkUpdateModal:", error);
    alert("An error occurred: " + error.message);
  }
}

async function initPicklistProcessing() {
  if (!window.location.pathname.includes("/lightning/setup/")) return;

  if (isObjectManagerHomePage()) {
    (async () => {
      try {
        const tableBody = await waitForElement("table tbody");
        const scrollable = findScrollableParent(tableBody);
        if (scrollable) {
          await autoScrollAndWait(scrollable);
          console.log("Auto scrolling finished for home page.");
        }

        const container = await waitForElement(".objectManagerGlobalSearchBox, div[role='search']");
        container.style.cssText = "display: flex; align-items: center; justify-content: flex-end;";
        const input = container.querySelector("input[type='search']");
        if (input) setupCustomQuickFind(input);

        if (!document.getElementById("exportSelectionButton")) {
          const selectionButton = document.createElement("button");
          selectionButton.id = "exportSelectionButton";
          selectionButton.textContent = "Select Objects to Export";
          selectionButton.style.cssText = "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
          selectionButton.addEventListener("click", async () => { await showExportSelectionModal(); });
          container.appendChild(selectionButton);
        }

        console.log("Home page initialization complete.");
      } catch (error) {
        console.error("Error during home page initialization:", error);
      }
    })();
    return;
  }

  removeSetupHomeModules();

  (async () => {
    const objectName = await getObjectApiNameFromURL();
    if (objectName && lastObjectName && lastObjectName !== objectName) {
      const existing = document.getElementById("customQuickFind");
      if (existing) existing.remove();
    }
    lastObjectName = objectName;

    let originalQuickFind;
    try {
      originalQuickFind = await getOriginalQuickFind();
      console.log("Found original Quick Find.");
    } catch (error) {
      console.warn("Quick Find not found, using fallback on FieldsAndRelationships page.");
    }

    try {
      const tableBody = await waitForElement("table tbody");
      const scrollable = findScrollableParent(tableBody);
      if (scrollable) {
        await autoScrollAndWait(scrollable);
        console.log("Auto scrolling finished on detail page.");
      }

      if (originalQuickFind) {
        setupCustomQuickFind(originalQuickFind);
      } else if (window.location.pathname.includes("FieldsAndRelationships")) {
        if (!document.getElementById("exportDetailXLSXButton")) {
          const fallbackContainer = document.querySelector(".objectManagerGlobalSearchBox, div[role='search']") || document.body;
          const exportButton = document.createElement("button");
          exportButton.id = "exportDetailXLSXButton";
          exportButton.textContent = "Export XLSX";
          exportButton.style.cssText = "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
          exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
          fallbackContainer.appendChild(exportButton);
        }
      }

      if (window.location.pathname.includes("FieldsAndRelationships")) {
        addBulkUpdateButton();
      }

      processPicklistRows();
      const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes.length)) processPicklistRows();
      });
      observer.observe(tableBody, { childList: true });

      console.log("Detail page initialization complete.");
    } catch (error) {
      console.error("Error during detail page initialization:", error);
    }
  })();
}

let lastObjectName = null;

window.addEventListener("location-changed", () => {
  console.log("location-changed event detected.");
  lastObjectName = null;
  window.customObjectId = null;
  setTimeout(initPicklistProcessing, 500);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "location-changed") {
    console.log("Received location-changed from background.");
    lastObjectName = null;
    window.customObjectId = null;
    setTimeout(initPicklistProcessing, 500);
  }
});

initPicklistProcessing().catch(console.error);

async function getCustomFieldDescription(fieldApiName, objectApiName, objectId, origin, storeId) {
  const sessionId = await getSessionCookie(origin, storeId);
  if (!sessionId) return { success: false, error: "No session cookie found." };

  const apiOrigin = getMySalesforceDomain(origin);
  try {
    let developerName = fieldApiName;
    if (fieldApiName.endsWith('__c')) {
      developerName = fieldApiName.slice(0, -3);
    }

    const tableEnumOrId = objectId || objectApiName;
    const query = `SELECT Id, DeveloperName, Description, InlineHelpText FROM CustomField WHERE DeveloperName = '${developerName}' AND TableEnumOrId = '${tableEnumOrId}' LIMIT 1`;
    const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;

    console.log(`Querying for description of ${fieldApiName} in ${objectApiName}`);
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + sessionId }
    });

    if (!response.ok) {
      console.error(`API error getting field description: ${response.status} ${response.statusText}`);
      return { success: false, error: `API error: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    if (data.records && data.records.length > 0) {
      const record = data.records[0];
      console.log(`Got description for ${fieldApiName}:`, {
        description: record.Description || '',
        helpText: record.InlineHelpText || ''
      });
      return { success: true, description: record.Description || '', helpText: record.InlineHelpText || '' };
    } else {
      console.log(`No description found for ${fieldApiName}`);
      return { success: false, error: "Field not found" };
    }
  } catch (error) {
    console.error("Error getting field description:", error);
    return { success: false, error: error.message };
  }
}
