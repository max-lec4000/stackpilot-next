import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeCap, validSizeFormat, validSizeProfile } from "./size-limits.js";
test("Größenobergrenze richtet sich nach Laufzeit und rundet nur auf halbe GiB", () => {
  assert.equal(sizeCap(120, 3), 6);
  assert.equal(sizeCap(101, 3), 5.5);
  assert.equal(sizeCap(240, 3), 12);
  for (const [duration, rate] of [
    [0, 3],
    [NaN, 3],
    [120, 0],
    [120, 99],
  ])
    assert.throws(() => sizeCap(duration, rate));
});
test("Native Größenregeln erkennen zusätzliche Spezifikationen, andere Grenzen und kompensierende Scores", () => {
  const format = {
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          implementation: "SizeSpecification",
          required: true,
          negate: false,
          fields: [
            { name: "min", value: 0 },
            { name: "max", value: 6 },
          ],
        },
      ],
    },
    profile = {
      upgradeAllowed: false,
      minFormatScore: 1,
      items: [{ allowed: true, quality: { name: "WEBDL-1080p" } }],
      formatItems: [
        { format: 1, score: 1 },
        { format: 2, score: 0 },
      ],
    };
  assert.equal(validSizeFormat(format, 6), true);
  assert.equal(validSizeFormat(format, 7), false);
  assert.equal(validSizeProfile(profile, 1), true);
  assert.equal(
    validSizeProfile(
      {
        ...profile,
        formatItems: [
          { format: 1, score: 1 },
          { format: 2, score: 1 },
        ],
      },
      1,
    ),
    false,
  );
  assert.equal(
    validSizeProfile({ ...profile, upgradeAllowed: true }, 1),
    false,
  );
});
