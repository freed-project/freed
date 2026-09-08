function collectFacebookAdvertisingEvidence(root) {
  var evidenceCodes = [];
  var seenEvidence = {};
  var inspectedNodes = 0;
  var referencedLabels = 0;
  var maximumNodes = 96;
  var maximumReferences = 16;

  function addEvidence(code) {
    if (!seenEvidence[code]) {
      seenEvidence[code] = true;
      evidenceCodes.push(code);
    }
  }

  function normalizeDisclosure(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isVisibleDisclosureNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    var style = String(node.getAttribute("style") || "").toLowerCase();
    return !/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)/.test(style);
  }

  function belongsToPlacement(node) {
    var nestedArticle = node.closest && node.closest('[role="article"]');
    return !nestedArticle || nestedArticle === root;
  }

  function isBodyContent(node) {
    return Boolean(node.closest && node.closest('[data-ad-preview="message"], [dir="auto"], [role="blockquote"]'));
  }

  try {
    if (!root || root.nodeType !== 1) {
      return {
        inspectionStatus: "failed",
        evidenceCodes: ["collector_failure"],
      };
    }

    if (
      root.matches('[data-testid="sponsored_label"]') ||
      root.querySelector('[data-testid="sponsored_label"]')
    ) {
      addEvidence("explicit_sponsored_testid");
    }

    var structuredNodes = [root].concat(
      Array.prototype.slice.call(
        root.querySelectorAll('[data-ft], [data-ad-id], [data-sponsored]'),
      ),
    );
    for (var structuredIndex = 0; structuredIndex < structuredNodes.length; structuredIndex++) {
      var structuredNode = structuredNodes[structuredIndex];
      var structuredValue = [
        structuredNode.getAttribute("data-ft"),
        structuredNode.getAttribute("data-ad-id"),
        structuredNode.getAttribute("data-sponsored"),
      ].join(" ");
      if (/\bad_id\b|\bsponsored_data\b|\bpaid_partnership\b/i.test(structuredValue)) {
        addEvidence("structured_ad_metadata");
        break;
      }
    }

    var disclosureTexts = [];
    var nodes = root.querySelectorAll(
      'header, h1, h2, h3, h4, a, span, [aria-label], [aria-labelledby], [data-testid]'
    );
    for (var index = 0; index < nodes.length; index++) {
      var node = nodes[index];
      if (!belongsToPlacement(node) || isBodyContent(node) || !isVisibleDisclosureNode(node)) continue;
      inspectedNodes++;
      if (inspectedNodes > maximumNodes) {
        addEvidence("inspection_limit_exceeded");
        return { inspectionStatus: "incomplete", evidenceCodes: evidenceCodes };
      }

      var ariaLabel = normalizeDisclosure(node.getAttribute("aria-label"));
      if (/\bsponsored\b/.test(ariaLabel)) {
        addEvidence("accessible_sponsored_label");
      } else if (/^spons(?:or(?:e|ed?)?)?$/.test(ariaLabel)) {
        addEvidence("partial_sponsored_disclosure");
      }

      var labelledBy = String(node.getAttribute("aria-labelledby") || "").trim();
      if (labelledBy) {
        var ids = labelledBy.split(/\s+/);
        for (var refIndex = 0; refIndex < ids.length; refIndex++) {
          referencedLabels++;
          if (referencedLabels > maximumReferences) {
            addEvidence("inspection_limit_exceeded");
            return { inspectionStatus: "incomplete", evidenceCodes: evidenceCodes };
          }
          var referenced = document.getElementById(ids[refIndex]);
          if (!referenced || !root.contains(referenced) || !isVisibleDisclosureNode(referenced)) continue;
          if (/\bsponsored\b/.test(normalizeDisclosure(referenced.textContent))) {
            addEvidence("referenced_sponsored_label");
          }
        }
      }

      if (node.tagName === "A") {
        var href = node.getAttribute("href") || "";
        try {
          var url = new URL(href, "https://www.facebook.com/");
          var host = url.hostname.toLowerCase();
          if (
            (host === "facebook.com" || host.endsWith(".facebook.com")) &&
            (/^\/ads\/(?:about|library)(?:\/|$)/i.test(url.pathname) || /^\/business\/ads(?:\/|$)/i.test(url.pathname))
          ) {
            addEvidence("verified_ad_disclosure_link");
          }
        } catch (_) {}
      }

      if (node.children.length === 0) {
        var disclosureText = normalizeDisclosure(node.textContent);
        if (disclosureText && disclosureText.length <= 40) disclosureTexts.push(disclosureText);
      }
    }

    for (var textIndex = 0; textIndex < disclosureTexts.length; textIndex++) {
      var splitDisclosure = "";
      for (
        var textEnd = textIndex;
        textEnd < disclosureTexts.length && textEnd < textIndex + 10;
        textEnd++
      ) {
        splitDisclosure += disclosureTexts[textEnd].replace(/\s+/g, "");
        if (splitDisclosure === "sponsored") {
          addEvidence("split_sponsored_disclosure");
          break;
        }
        if (splitDisclosure.length > "sponsored".length) break;
      }
    }

    return { inspectionStatus: "complete", evidenceCodes: evidenceCodes };
  } catch (_) {
    return {
      inspectionStatus: "failed",
      evidenceCodes: ["collector_failure"],
    };
  }
}
