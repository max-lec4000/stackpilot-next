// Provider instructions are displayed as text, never interpreted as HTML.
export function sourceText(value, limit = 1600) {
  if (typeof value !== "string") return "";
  return value
    .slice(0, limit * 4)
    .replace(/<(br|\/p|\/li|\/ol|\/ul)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(nbsp|amp|quot|apos|lt|gt|#39);/g,
      (_, key) =>
        ({
          nbsp: " ",
          amp: "&",
          quot: '"',
          apos: "'",
          lt: "<",
          gt: ">",
          "#39": "'",
        })[key],
    )
    .trim()
    .slice(0, limit);
}
export function sourceUrls(schema) {
  return (Array.isArray(schema.indexerUrls) ? schema.indexerUrls : []).filter(
    (value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          ![...url.searchParams.keys()].some((key) =>
            /^(api[-_]?key|passkey|token|password|auth)$/i.test(key),
          )
        );
      } catch {
        return false;
      }
    },
  );
}
export function sourceDefault(schema, field) {
  if (
    field.name?.toLowerCase() === "baseurl" &&
    (field.value === null || field.value === undefined || field.value === "")
  )
    return sourceUrls(schema)[0] || "";
  return field.value ?? "";
}
export function sourceFieldSupported(type) {
  return [
    "textbox",
    "password",
    "checkbox",
    "select",
    "number",
    "tag",
    "selectMultiple",
    "path",
    "url",
    "info",
  ].includes(type);
}
