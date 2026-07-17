import fs from "node:fs";
import path from "node:path";
import { CONTENT_ROOT } from "./content-loader";

export interface Friend {
  name: string;
  url: string;
  description?: string;
  avatar?: string;
}

export function getFriends(): Friend[] {
  const file = path.join(CONTENT_ROOT, "friends.json");
  if (!fs.existsSync(file)) return [];
  const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) return [];
  return data.filter(
    (item): item is Friend =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Friend).name === "string" &&
      typeof (item as Friend).url === "string",
  );
}
