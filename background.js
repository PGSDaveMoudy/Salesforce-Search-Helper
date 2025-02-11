// Helper: Return a promise that resolves with the session cookie value (“sid”)
async function getSessionCookie(origin) {
  let cookieUrl = origin;
  if (cookieUrl.includes("lightning.force.com")) {
    cookieUrl = cookieUrl.replace("lightning.force.com", "my.salesforce.com");
  }
  return new Promise((resolve) => {
    chrome.cookies.get({ url: cookieUrl, name: "sid" }, (cookie) => {
      resolve(cookie ? cookie.value : null);
    });
  });
}

async function fetchPicklistValues({ objectName, fieldApiName, origin, isStandard }) {
  const sessionId = await getSessionCookie(origin);
  if (!sessionId) {
    return { success: false, error: "No session cookie found." };
  }
  let apiOrigin = origin;
  if (apiOrigin.includes("lightning.force.com")) {
    apiOrigin = apiOrigin.replace("lightning.force.com", "my.salesforce.com");
  }

  if (isStandard) {
    const url = `${apiOrigin}/services/data/v56.0/sobjects/${objectName}/describe`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      }
    });
    if (!response.ok) throw new Error(`Describe API error: ${response.status}`);
    const data = await response.json();
    // Use a case‑sensitive (or adjust as needed) match on field API name
    const field = data.fields.find(f => f.name === fieldApiName);
    if (field && field.picklistValues && field.picklistValues.length > 0) {
      const picklistText = field.picklistValues
        .map(v => (v.label || "").toLowerCase())
        .join(", ");
      return { success: true, data: { picklistText } };
    } else {
      return { success: true, data: { picklistText: "" } };
    }
  } else {
    // For custom fields, strip off the trailing __c for the DeveloperName
    const queryFieldName = fieldApiName.replace(/__c$/, "");
    const query = `SELECT Metadata FROM CustomField WHERE DeveloperName = '${queryFieldName}' AND TableEnumOrId = '${objectName}'`;
    const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      }
    });
    if (!response.ok) throw new Error(`Tooling API error: ${response.status}`);
    const data = await response.json();
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
    return { success: true, data: { picklistText } };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchPicklistValues") {
    fetchPicklistValues(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true; // keep the messaging channel open for async response
  }
});
