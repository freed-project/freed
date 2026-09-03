import assert from "node:assert/strict";
import test from "node:test";

import {
  eligiblePage,
  sampleCorpusRejectionText,
  sampleCorpusSubjectIdentityText,
} from "./generate-sample-corpus.mjs";

function commonsPage({ title, categories, description = "" }) {
  return {
    title: `File:${title}.jpg`,
    categories: categories.map((category) => ({
      title: `Category:${category}`,
    })),
    imageinfo: [
      {
        mime: "image/jpeg",
        width: 2_400,
        height: 1_600,
        sha1: "a".repeat(40),
        extmetadata: {
          LicenseShortName: { value: "CC BY-SA 4.0" },
          ImageDescription: { value: description },
        },
      },
    ],
  };
}

test("subject identity uses the Commons title and categories, never prose", () => {
  const page = commonsPage({
    title: "Great Crested Grebe",
    categories: ["Podiceps cristatus swimming (pairs)"],
    description:
      "Five pairs of grebes shared the water with mute swans during courtship.",
  });

  assert.match(sampleCorpusSubjectIdentityText(page), /Great Crested Grebe/);
  assert.doesNotMatch(sampleCorpusSubjectIdentityText(page), /mute swans/);
  assert.match(sampleCorpusRejectionText(page), /mute swans/);
  assert.equal(eligiblePage(page, "swan"), false);
});

test("rejects the Praying Mantis band without rejecting the animal", () => {
  const band = commonsPage({
    title: "Praying Mantis at Stockholm",
    categories: ["Praying Mantis (band)", "Musicians on stage in Sweden"],
    description: "English heavy metal musicians performing in concert.",
  });
  const animal = commonsPage({
    title: "Brown Praying Mantis",
    categories: ["Mantis religiosa heads and raptorial legs"],
    description: "A brown praying mantis resting on a leaf.",
  });

  assert.equal(eligiblePage(band, "praying mantis"), false);
  assert.ok(eligiblePage(animal, "praying mantis"));
});

test("rejects photographed documents and preserved birds from description", () => {
  const photographedPage = commonsPage({
    title: "Swan courtship study",
    categories: ["Cygnus olor pairs"],
    description:
      "A double page spread showing a dead pigeon posed in courtship posture.",
  });
  const livingPair = commonsPage({
    title: "Two white birds on open water",
    categories: ["Cygnus olor pairs"],
    description: "A living swan pair courting on open water.",
  });

  assert.equal(eligiblePage(photographedPage, "swan"), false);
  assert.ok(eligiblePage(livingPair, "swan"));
});
