// Helper: Return a promise that resolves with the session cookie value (“sid”)
async function getSessionCookie(origin) {
  try {
    // Normalize the domain so that both production and sandbox resolve to my.salesforce.com.
    // Example: "https://cs1.sandbox.lightning.force.com" becomes "https://cs1.my.salesforce.com"
    let cookieUrl = origin;
    const match = origin.match(/^(https:\/\/[^.]+)(?:\.sandbox)?\.(?:lightning\.force\.com|salesforce-setup\.com)/);
    if (match) {
      cookieUrl = match[1] + ".my.salesforce.com";
    }
    return new Promise((resolve) => {
      chrome.cookies.get({ url: cookieUrl, name: "sid" }, (cookie) => {
        resolve(cookie?.value || null);
      });
    });
  } catch (error) {
    console.error("Error getting session cookie:", error);
    return null;
  }
}

// Fetch picklist values using Salesforce APIs
async function fetchPicklistValues({ objectName, fieldApiName, origin, isStandard }) {
  const sessionId = await getSessionCookie(origin);
  if (!sessionId) {
    return { success: false, error: "No session cookie found." };
  }

  let apiOrigin = origin;
  const matchApi = origin.match(/^(https:\/\/[^.]+)(?:\.sandbox)?\.(?:lightning\.force\.com|salesforce-setup\.com)/);
  if (matchApi) {
    apiOrigin = matchApi[1] + ".my.salesforce.com";
  }

  try {
    if (isStandard) {
      // Standard Object Describe API call
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
      // Custom Object Tooling API call
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

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchPicklistValues") {
    fetchPicklistValues(message)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true; // Keep the messaging channel open for async response
  }
});
