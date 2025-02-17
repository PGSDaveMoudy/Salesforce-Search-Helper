/**
* @File Name : background.js
* @Description : Handles session cookie retrieval, picklist and object describe fetching via Salesforce API.
* @Author : Dave Moudy
* @Last Modified By :
* @Last Modified On :
* @Modification Log :
*==============================================================================
* Ver | Date         | Author    | Modification
*==============================================================================
* 1.0 | February 16,2025 |         | Initial Version
* 1.1 | February 18,2025 | Dave Moudy | Updated URL conversion to support dev orgs
**/

// Helper to convert a Lightning URL into its My Salesforce domain.
// For example, converts:
//   https://portwoodglobal-dev-ed.develop.lightning.force.com
// to:
//   https://portwoodglobal-dev-ed.develop.my.salesforce.com
function getMySalesforceDomain(origin) {
  if (origin.includes("lightning.force.com")) {
    return origin.replace("lightning.force.com", "my.salesforce.com");
  } else if (origin.includes("salesforce-setup.com")) {
    return origin.replace("salesforce-setup.com", "my.salesforce.com");
  }
  return origin;
}

async function getSessionCookie(origin) {
  try {
    let cookieUrl = getMySalesforceDomain(origin);
    return new Promise(resolve => {
      chrome.cookies.get({ url: cookieUrl, name: "sid" }, cookie => {
        resolve(cookie?.value || null);
      });
    });
  } catch (error) {
    console.error("Error getting session cookie:", error);
    return null;
  }
}

async function fetchPicklistValues({ objectName, fieldApiName, origin, isStandard }) {
  const sessionId = await getSessionCookie(origin);
  if (!sessionId) return { success: false, error: "No session cookie found." };
  const apiOrigin = getMySalesforceDomain(origin);
  try {
    if (isStandard) {
      const url = `${apiOrigin}/services/data/v56.0/sobjects/${objectName}/describe`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`
        }
      });
      if (!response.ok) throw new Error(`Describe API error: ${response.statusText}`);
      const data = await response.json();
      const field = data.fields.find(f => f.name.toLowerCase() === fieldApiName.toLowerCase());
      const picklistText = field?.picklistValues?.map(v => v.label?.toLowerCase() || "").join(", ") || "";
      return { success: true, data: { picklistText } };
    } else {
      const queryFieldName = fieldApiName.replace(/__c$/, "");
      const query = `SELECT Metadata FROM CustomField WHERE DeveloperName = '${queryFieldName}' AND TableEnumOrId = '${objectName}'`;
      const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionId}`
        }
      });
      if (!response.ok) throw new Error(`Tooling API error: ${response.statusText}`);
      const data = await response.json();
      const values = data.records?.[0]?.Metadata?.valueSet?.valueSetDefinition?.value || [];
      const picklistText = values.map(v => v.label?.toLowerCase() || "").join(", ");
      return { success: true, data: { picklistText } };
    }
  } catch (error) {
    console.error("Error fetching picklist values:", error);
    return { success: false, error: error.message };
  }
}

async function fetchObjectDescribe({ objectApiName, origin }) {
  const sessionId = await getSessionCookie(origin);
  if (!sessionId) return { success: false, error: "No session cookie found." };
  const apiOrigin = getMySalesforceDomain(origin);
  try {
    const url = `${apiOrigin}/services/data/v56.0/sobjects/${objectApiName}/describe`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${sessionId}`
      }
    });
    if (!response.ok) throw new Error(`Describe API error: ${response.statusText}`);
    const data = await response.json();
    const fields = data.fields.map(field => ({
      fieldLabel: field.label,
      fieldApiName: field.name,
      fieldType: field.type,
      fieldLength: field.length ? field.length : "",
      picklistValues: field.picklistValues && field.picklistValues.length
        ? field.picklistValues.map(v => v.label).join(", ")
        : ""
    }));
    return { success: true, fields };
  } catch (error) {
    console.error("Error fetching object describe:", error);
    return { success: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchPicklistValues") {
    fetchPicklistValues(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }
  if (message.type === "fetchObjectDescribe") {
    fetchObjectDescribe(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }
});

// Forward navigation events detected by the webNavigation API.
chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0 && details.url.includes("/lightning/setup/")) {
    chrome.tabs.sendMessage(details.tabId, { type: "location-changed" });
  }
});
