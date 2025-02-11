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

  // Return true if we're on any Object Manager page.
  function isObjectManagerPage() {
    return window.location.pathname.includes("/lightning/setup/ObjectManager/");
  }

  // Return true if we're on the Object Manager home page.
  function isObjectManagerHomePage() {
    return window.location.pathname.includes("/lightning/setup/ObjectManager/home");
  }

  // Wait for an element matching the selector (with timeout).
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

  // Recursive auto-scroll until the container’s scrollHeight stops increasing.
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
    if (originalInput.dataset.customized === "true") {
      console.log("Custom Quick Find input already set up.");
      return;
    }
    const newInput = originalInput.cloneNode(true);
    newInput.id = "globalQuickfind";
    newInput.dataset.customized = "true";
    if (originalInput.parentNode) {
      originalInput.parentNode.replaceChild(newInput, originalInput);
      console.log("Replaced original Quick Find input with a clone.");
    } else {
      console.warn("Original Quick Find input has no parent; skipping replacement.");
    }
    customQuickFindInput = newInput;
    newInput.addEventListener("input", onQuickFindInput);
    console.log("Custom Quick Find event listener attached.");
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
    // Do nothing on Object Manager home.
    if (isObjectManagerHomePage()) {
      console.log("Object Manager home page detected – skipping initialization.");
      return;
    }
    // Only initialize if we are on an Object Manager sub‑page.
    if (!isObjectManagerPage()) {
      console.log("Not on an Object Manager page – skipping initialization.");
      return;
    }
    try {
      // Wait for the Quick Find input.
      const originalQuickFind = await waitForElement("input#globalQuickfind");
      console.log("Global Quick Find input found.");
      // Wait for the table body.
      await waitForElement("table tbody");
      // If a container exists, auto-scroll.
      const container = document.querySelector(
        ".scroller.uiScroller.scroller-wrapper.scroll-bidirectional.native"
      );
      if (container) {
        await autoScrollAndWait(container);
        console.log("Finished auto scrolling.");
      }
      setupCustomQuickFind(originalQuickFind);
      processPicklistRows();
      // Observe new rows in case additional data loads.
      const tableBody = document.querySelector("table tbody");
      if (tableBody) {
        const observer = new MutationObserver(mutations => {
          if (mutations.some(mutation => mutation.addedNodes.length)) {
            processPicklistRows();
          }
        });
        observer.observe(tableBody, { childList: true });
      }
      console.log("Custom Quick Find and picklist fetch setup complete.");
    } catch (error) {
      console.error("Error initializing picklist processing:", error);
    }
  }

  // A MutationObserver on the document body to detect when the fields/relationships view loads.
  const pageObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Look for a table with a tbody.
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

  // Listen for Lightning navigation events.
  window.addEventListener("location-changed", () => {
    console.log("Navigation detected.");
    initPicklistProcessing();
  });

  // Initial run.
  await initPicklistProcessing();
})();
