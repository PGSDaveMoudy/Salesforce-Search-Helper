function getAllPossibleDomains(origin) {
  const url = new URL(origin);
  const hostname = url.hostname;
  const protocol = url.protocol;
  const domainParts = hostname.split(".");
  
  // Extract the instance identifier if present (cs12, na44, etc.)
  const instanceMatch = hostname.match(/\.(cs\d+|cs|na\d+|gs0|eu\d+)\./i);
  const instance = instanceMatch ? instanceMatch[1] : null;
  
  // For sandbox URLs with -- pattern
  const sandboxMatch = hostname.match(/([^-]+)--([^.]+)/);
  const orgName = sandboxMatch ? sandboxMatch[1] : domainParts[0];
  const sandboxName = sandboxMatch ? sandboxMatch[2] : null;
  
  // Create array of domains to try
  const domains = [];
  
  // Start with the converted domain from our helper function
  domains.push(getMySalesforceDomain(origin));
  
  // Add the original domain
  domains.push(origin);
  
  if (sandboxName) {
    // Sandbox specific patterns
    domains.push(`${protocol}//${orgName}--${sandboxName}.my.salesforce.com`);
    domains.push(`${protocol}//${orgName}--${sandboxName}.sandbox.my.salesforce.com`);
    
    // With instance if available
    if (instance) {
      domains.push(`${protocol}//${orgName}--${sandboxName}.${instance}.my.salesforce.com`);
    }
    
    // Try different variations of the sandbox domain
    domains.push(`${protocol}//test.salesforce.com`);
    domains.push(`${protocol}//${sandboxName}.${orgName}.my.salesforce.com`);
  }
  
  // Add some generic Salesforce domains
  domains.push(`${protocol}//my.salesforce.com`);
  domains.push(`${protocol}//login.salesforce.com`);
  domains.push(`${protocol}//salesforce.com`);
  domains.push(`${protocol}//cloudforce.com`);
  
  // Add sandbox specific generic domains
  domains.push(`${protocol}//sandbox.my.salesforce.com`);
  domains.push(`${protocol}//test.salesforce.com`);
  
  // Return unique domains only
  return [...new Set(domains)];
}

function getMySalesforceDomain(origin) {
  console.log("Converting domain for:", origin);
  
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Check if this is a sandbox URL (contains -- pattern)
    const sandboxMatch = hostname.match(/([^-]+)--([^.]+)\.(.*)/);
    
    if (sandboxMatch) {
      const orgName = sandboxMatch[1];
      const sandboxName = sandboxMatch[2];
      const restOfDomain = sandboxMatch[3];
      
      if (restOfDomain.includes("lightning.force.com")) {
        // Convert from lightning to my.salesforce.com while preserving sandbox info
        const newDomain = `${url.protocol}//${orgName}--${sandboxName}.my.salesforce.com`;
        console.log("Sandbox converted to:", newDomain);
        return newDomain;
      }
    }
    
    // Handle standard cases
    if (hostname.includes("lightning.force.com")) {
      return origin.replace("lightning.force.com", "my.salesforce.com");
    } else if (hostname.includes("salesforce-setup.com")) {
      return origin.replace("salesforce-setup.com", "my.salesforce.com");
    }
    
    return origin;
  } catch (e) {
    console.error("Error in getMySalesforceDomain:", e);
    return origin;
  }
}

async function getSessionCookie(origin, storeId) {
  try {
    console.log("Getting session cookie for origin:", origin);
    
    // Get all relevant domains to try
    const domainsToTry = getAllPossibleDomains(origin);
    console.log("Will try these domains:", domainsToTry);
    
    // Try each domain pattern
    for (const domain of domainsToTry) {
      const details = { 
        url: domain, 
        name: "sid" 
      };
      
      if (storeId) {
        details.storeId = storeId;
      }
      
      console.log(`Trying to get cookie for URL: ${domain}`);
      const cookie = await new Promise(resolve => {
        chrome.cookies.get(details, resolve);
      });
      
      if (cookie && cookie.value) {
        console.log(`SUCCESS! Found cookie in domain: ${domain}`);
        // Store the successful domain to use for API calls
        global.lastSuccessfulCookieDomain = domain;
        return cookie.value;
      } else {
        console.log(`No cookie found for domain: ${domain}`);
      }
    }
    
    // Fallback: Get ALL cookies and search for sid
    console.log("No cookie found in specific domains, trying to list all cookies...");
    try {
      const allCookies = await new Promise(resolve => {
        chrome.cookies.getAll({}, resolve);
      });
      
      const sidCookies = allCookies.filter(c => c.name === "sid");
      console.log("Found these sid cookies:", sidCookies);
      
      if (sidCookies.length > 0) {
        // Prioritize cookies with domains that match our origin
        const originDomain = new URL(origin).hostname;
        const matchingCookie = sidCookies.find(c => originDomain.includes(c.domain) || c.domain.includes(originDomain));
        
        if (matchingCookie) {
          console.log("Found matching sid cookie:", matchingCookie);
          global.lastSuccessfulCookieDomain = `https://${matchingCookie.domain}`;
          return matchingCookie.value;
        }
        
        // If no matching cookie, just take the first one
        console.log("Using first available sid cookie:", sidCookies[0]);
        global.lastSuccessfulCookieDomain = `https://${sidCookies[0].domain}`;
        return sidCookies[0].value;
      }
    } catch (e) {
      console.error("Error listing all cookies:", e);
    }
    
    console.log("Could not find any session cookie");
    return null;
  } catch (error) {
    console.error("Error getting session cookie:", error);
    return null;
  }
}

async function fetchPicklistValues({ objectName, fieldApiName, origin, isStandard, storeId }) {
  const sessionId = await getSessionCookie(origin, storeId);
  
  if (!sessionId)
    return { success: false, error: "No session cookie found." };
  
  // Use the last successful domain if available, otherwise convert the origin
  const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
  console.log(`Using API origin: ${apiOrigin} for picklist values`);
  
  try {
    if (isStandard) {
      const url = `${apiOrigin}/services/data/v56.0/sobjects/${objectName}/describe`;
      console.log(`Fetching standard picklist values from: ${url}`);
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sessionId
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Describe API error: ${response.statusText}`, errorText);
        throw new Error(`Describe API error: ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      const field = data.fields.find(
        f => f.name.toLowerCase() === fieldApiName.toLowerCase()
      );
      
      const picklistText =
        field?.picklistValues?.map(v => (v.label || "").toLowerCase()).join(", ") || "";
      
      return { success: true, data: { picklistText } };
    } else {
      const queryFieldName = fieldApiName.replace(/__c$/, "");
      const query = `SELECT Metadata FROM CustomField WHERE DeveloperName = '${queryFieldName}' AND TableEnumOrId = '${objectName}'`;
      const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;
      
      console.log(`Fetching custom picklist values from: ${url}`);
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sessionId
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Tooling API error: ${response.statusText}`, errorText);
        throw new Error(`Tooling API error: ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      const values = data.records?.[0]?.Metadata?.valueSet?.valueSetDefinition?.value || [];
      const picklistText = values.map(v => (v.label || "").toLowerCase()).join(", ");
      
      return { success: true, data: { picklistText } };
    }
  } catch (error) {
    console.error("Error fetching picklist values:", error);
    return { success: false, error: error.message };
  }
}

async function fetchObjectDescribe({ objectApiName, origin, storeId }) {
  const sessionId = await getSessionCookie(origin, storeId);

  if (!sessionId)
    return { success: false, error: "No session cookie found." };

  const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
  console.log(`Using API origin: ${apiOrigin} for object describe`);

  try {
    const url = `${apiOrigin}/services/data/v56.0/sobjects/${objectApiName}/describe`;
    console.log(`Fetching object describe from: ${url}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      }
    });

    if (!response.ok)
      throw new Error(`Describe API error: ${response.statusText}`);

    const data = await response.json();
    const isCustomObject = objectApiName.endsWith('__c');

    let customFieldsMetadata = {};

    try {
      const fieldApiNames = data.fields.map(f => f.name);

      if (fieldApiNames.length > 0) {
        const batchSize = 20;
        let allRecords = [];

        for (let i = 0; i < fieldApiNames.length; i += batchSize) {
          const batchFields = fieldApiNames.slice(i, i + batchSize);
          let query;

          if (isCustomObject) {
            const customFieldNames = batchFields.filter(name => name.endsWith('__c')).map(name => name.replace('__c', ''));

            if (customFieldNames.length === 0) continue;

            query = `SELECT DeveloperName, Description, InlineHelpText FROM CustomField WHERE TableEnumOrId = '${objectApiName}' AND DeveloperName IN ('${customFieldNames.join("','")}')`;
          } else {
            query = `SELECT EntityDefinition.QualifiedApiName, QualifiedApiName, Description, InlineHelpText FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${objectApiName}' AND QualifiedApiName IN ('${batchFields.join("','")}')`;
          }

          const toolingUrl = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;

          const toolingResponse = await fetch(toolingUrl, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + sessionId
            }
          });

          if (toolingResponse.ok) {
            const toolingData = await toolingResponse.json();
            allRecords = [...allRecords, ...toolingData.records];
          }
        }

        allRecords.forEach(record => {
          let fieldName;

          if (isCustomObject) {
            fieldName = record.DeveloperName + '__c';
          } else {
            fieldName = record.QualifiedApiName;
          }

          customFieldsMetadata[fieldName] = {
            description: record.Description || '',
            helpText: record.InlineHelpText || ''
          };
        });

        console.log("Got enhanced metadata for fields:", customFieldsMetadata);
      }
    } catch (error) {
      console.error("Error fetching field metadata via Tooling API:", error);
    }

    const fields = data.fields.map(field => {
      const enhancedMetadata = customFieldsMetadata[field.name] || {};

      return {
        fieldLabel: field.label,
        fieldApiName: field.name,
        fieldType: field.type,
        fieldLength: field.length || "",
        formula: field.calculatedFormula || "",
        helpText: enhancedMetadata.helpText || field.inlineHelpText || "",
        description: enhancedMetadata.description || field.description || "",
        picklistValues: (field.picklistValues && field.picklistValues.length)
          ? field.picklistValues.map(v => v.label).join(", ")
          : ""
      };
    });

    return { success: true, fields, objectName: data.name };
  } catch (error) {
    console.error("Error fetching object describe:", error);
    return { success: false, error: error.message };
  }
}

async function fetchCustomObjectApiName(objectId, origin, storeId) {
  const sessionId = await getSessionCookie(origin, storeId);

  if (!sessionId)
    return { success: false, error: "No session cookie found." };

  const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
  console.log(`Using API origin: ${apiOrigin} for custom object API name`);

  const query = `SELECT DeveloperName, Id FROM CustomObject WHERE Id = '${objectId}'`;
  const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      }
    });

    if (!response.ok)
      throw new Error(`Tooling API error: ${response.statusText}`);

    const data = await response.json();

    if (data.records && data.records.length > 0) {
      const developerName = data.records[0].DeveloperName;
      return { success: true, apiName: developerName + "__c", objectId: data.records[0].Id };
    } else {
      return { success: false, error: "No records found" };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getFieldMetadata(fieldId, origin, storeId) {
  const sessionId = await getSessionCookie(origin, storeId);

  if (!sessionId)
    return { success: false, error: "No session cookie found." };

  const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
  console.log(`Using API origin: ${apiOrigin} for field metadata`);

  const url = `${apiOrigin}/services/data/v56.0/tooling/sobjects/CustomField/${fieldId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      }
    });

    if (!response.ok) {
      let errorText = await response.text();
      try {
        const errorJson = JSON.parse(errorText);
        return { success: false, error: errorJson[0]?.message || `Error: ${response.status} ${response.statusText}`, details: errorJson };
      } catch (e) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}`, details: errorText };
      }
    }

    const fieldData = await response.json();

    try {
      const query = `SELECT Id, Description, InlineHelpText, Metadata FROM CustomField WHERE Id = '${fieldId}'`;
      const queryUrl = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;

      const additionalDataResponse = await fetch(queryUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sessionId
        }
      });

      if (additionalDataResponse.ok) {
        const additionalData = await additionalDataResponse.json();
        console.log("Additional field metadata response:", additionalData);

        if (additionalData.records && additionalData.records.length > 0) {
          const record = additionalData.records[0];
          fieldData.Description = record.Description;
          fieldData.InlineHelpText = record.InlineHelpText;

          if (record.Metadata) {
            if (!fieldData.Metadata) {
              fieldData.Metadata = {};
            }

            if (record.Description) {
              fieldData.Metadata.description = record.Description;
            }

            if (record.InlineHelpText) {
              fieldData.Metadata.inlineHelpText = record.InlineHelpText;
            }

            if (typeof record.Metadata === 'object') {
              Object.keys(record.Metadata).forEach(key => {
                if (!fieldData.Metadata[key]) {
                  fieldData.Metadata[key] = record.Metadata[key];
                }
              });
            }
          }
        }
      }
    } catch (error) {
      console.error("Error fetching additional field metadata:", error);
    }

    console.log("Final field metadata:", {
      "Field ID": fieldId,
      "Has Metadata object": Boolean(fieldData.Metadata),
      "Description in root": fieldData.Description,
      "Help Text in root": fieldData.InlineHelpText,
      "Description in Metadata": fieldData.Metadata?.description,
      "Help Text in Metadata": fieldData.Metadata?.inlineHelpText
    });

    return { success: true, fieldData };
  } catch (error) {
    console.error("Error retrieving field metadata:", error);
    return { success: false, error: error.message };
  }
}

async function updateFieldMetadata(fieldId, updatedData, origin, storeId) {
  const metadataResult = await getFieldMetadata(fieldId, origin, storeId);

  if (!metadataResult.success) {
    return metadataResult;
  }

  const fieldData = metadataResult.fieldData;

  if (!fieldData.Metadata) {
    return { success: false, error: `Field ${fieldId} does not have Metadata field available` };
  }

  try {
    const fieldType = fieldData.Metadata.type?.toLowerCase() || '';
    const hasValueSet = !!fieldData.Metadata.valueSet;

    if (['picklist', 'multipicklist'].includes(fieldType) || hasValueSet) {
      const directUpdatePayload = {};

      if (updatedData.Description !== undefined) {
        directUpdatePayload.Description = updatedData.Description;
      }

      if (updatedData.InlineHelpText !== undefined) {
        directUpdatePayload.InlineHelpText = updatedData.InlineHelpText;
      }

      const sessionId = await getSessionCookie(origin, storeId);
      if (!sessionId) return { success: false, error: "No session cookie found." };

      const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
      const url = `${apiOrigin}/services/data/v56.0/tooling/sobjects/CustomField/${fieldId}`;

      console.log(`Sending direct update for picklist/complex field ${fieldId}:`, directUpdatePayload);

      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sessionId
        },
        body: JSON.stringify(directUpdatePayload)
      });

      if (!response.ok) {
        let errorText = await response.text();
        console.error(`API error for field ${fieldId}:`, errorText);

        try {
          const errorJson = JSON.parse(errorText);
          return { success: false, error: errorJson[0]?.message || `Error: ${response.status} ${response.statusText}`, details: errorJson };
        } catch (e) {
          return { success: false, error: `API error: ${response.status} ${response.statusText}`, details: errorText };
        }
      }

      console.log(`Successfully updated picklist/complex field ${fieldId} with direct update`);
      return { success: true };
    }

    const metadataClone = JSON.parse(JSON.stringify(fieldData.Metadata));

    if (updatedData.Description !== undefined) {
      metadataClone.description = updatedData.Description;
      console.log(`Setting description for field ${fieldId} to:`, updatedData.Description);
    }

    if (updatedData.InlineHelpText !== undefined) {
      metadataClone.inlineHelpText = updatedData.InlineHelpText;
      console.log(`Setting helpText for field ${fieldId} to:`, updatedData.InlineHelpText);
    }

    if (metadataClone.valueSet === null && fieldData.Metadata.valueSet) {
      metadataClone.valueSet = fieldData.Metadata.valueSet;
    }

    const updatePayload = { Metadata: metadataClone };
    console.log(`Sending metadata update payload for field ${fieldId}:`, updatePayload);

    const sessionId = await getSessionCookie(origin, storeId);
    if (!sessionId) return { success: false, error: "No session cookie found." };

    const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
    const url = `${apiOrigin}/services/data/v56.0/tooling/sobjects/CustomField/${fieldId}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      },
      body: JSON.stringify(updatePayload)
    });

    if (!response.ok) {
      let errorText = await response.text();
      console.error(`API error for field ${fieldId}:`, errorText);

      try {
        const errorJson = JSON.parse(errorText);
        return { success: false, error: errorJson[0]?.message || `Error: ${response.status} ${response.statusText}`, details: errorJson };
      } catch (e) {
        return { success: false, error: `API error: ${response.status} ${response.statusText}`, details: errorText };
      }
    }

    console.log(`Successfully updated field ${fieldId}`);
    return { success: true };
  } catch (error) {
    console.error(`Exception updating field ${fieldId}:`, error);
    return { success: false, error: `Exception: ${error.message}` };
  }
}

async function getCustomFieldId(objectApiName, fieldApiName, origin, storeId, customObjectId = null) {
  const developerName = fieldApiName.replace(/__c$/, "");
  const sessionId = await getSessionCookie(origin, storeId);

  if (!sessionId)
    return { success: false, error: "No session cookie found." };

  const apiOrigin = global.lastSuccessfulCookieDomain || getMySalesforceDomain(origin);
  console.log(`Using API origin: ${apiOrigin} for custom field ID`);

  const tableEnumOrId = customObjectId || objectApiName;
  const query = `SELECT Id FROM CustomField WHERE DeveloperName = '${developerName}' AND TableEnumOrId = '${tableEnumOrId}'`;
  const url = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sessionId
      }
    });

    if (!response.ok) {
      let errorText = await response.text();
      console.error("API Error:", errorText);
      return { success: false, error: `API error: ${response.status} ${response.statusText}` };
    }

    const data = await response.json();

    if (data.records && data.records.length > 0) {
      return { success: true, fieldId: data.records[0].Id };
    } else {
      if (!customObjectId && objectApiName.endsWith('__c')) {
        const objectQuery = `SELECT Id FROM CustomObject WHERE DeveloperName = '${objectApiName.replace(/__c$/, '')}'`;
        const objectUrl = `${apiOrigin}/services/data/v56.0/tooling/query/?q=${encodeURIComponent(objectQuery)}`;

        const objectResponse = await fetch(objectUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + sessionId
          }
        });

        if (objectResponse.ok) {
          const objectData = await objectResponse.json();

          if (objectData.records && objectData.records.length > 0) {
            return getCustomFieldId(objectApiName, fieldApiName, origin, storeId, objectData.records[0].Id);
          }
        }
      }

      return { success: false, error: "Field not found." };
    }
  } catch (error) {
    console.error("Error getting custom field ID:", error);
    return { success: false, error: error.message };
  }
}

// Using global for background service worker
const global = {
  lastSuccessfulCookieDomain: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const storeId = sender?.tab?.cookieStoreId;

  // New handler for getSessionCookie
  if (message.type === "getSessionCookie") {
    getSessionCookie(message.origin, storeId)
      .then(cookieValue => sendResponse({ success: true, cookieValue }))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  if (message.type === "fetchPicklistValues") {
    fetchPicklistValues({ ...message, storeId })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  if (message.type === "fetchObjectDescribe") {
    fetchObjectDescribe({ ...message, storeId })
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  if (message.type === "fetchCustomObjectApiName") {
    fetchCustomObjectApiName(message.objectId, message.origin, storeId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }

  if (message.type === "bulkUpdateFields") {
    const updates = message.updates;
    const fieldNameMap = message.fieldNameMap || {};
    const origin = message.origin;

    const processUpdates = async () => {
      const results = [];
      const totalFields = Object.keys(updates).length;

      for (const fieldId of Object.keys(updates)) {
        const fieldName = fieldNameMap[fieldId] || fieldId;

        try {
          const result = await updateFieldMetadata(fieldId, updates[fieldId], origin, storeId);
          results.push({ fieldId, fieldName, ...result });
        } catch (error) {
          results.push({ fieldId, fieldName, success: false, error: error.message || "Exception occurred" });
        }
      }

      const succeeded = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (failed.length) {
        const errors = failed.map(f => `${f.fieldName}: ${f.error}`).join(';\n');
        const formattedErrorMessage = failed.map((f, index) => 
          `${index + 1}. <strong>${f.fieldName}</strong>: ${f.error}`
        ).join('<br>');

        sendResponse({ 
          success: failed.length === 0,
          error: `${failed.length} of ${totalFields} fields failed to update.`, 
          details: failed,
          errorMessage: errors,
          formattedErrorMessage: formattedErrorMessage,
          successCount: succeeded.length,
          failureCount: failed.length
        });
      } else {
        sendResponse({ success: true, message: `Successfully updated ${succeeded.length} fields.` });
      }
    };

    processUpdates();
    return true;
  }

  if (message.type === "getCustomFieldId") {
    const { objectApiName, fieldApiName, origin, customObjectId } = message;
    getCustomFieldId(objectApiName, fieldApiName, origin, storeId, customObjectId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.toString() }));
    return true;
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0 && details.url.includes("/lightning/setup/")) {
    chrome.tabs.sendMessage(details.tabId, { type: "location-changed" });
  }
});
