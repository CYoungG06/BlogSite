import fs from "node:fs";
import path from "node:path";
import { CONTENT_ROOT } from "./content-loader";

export interface MusicTrack {
  name: string;
  zhTitle: string;
  enTitle: string;
  year: number;
  noteZh: string;
  noteEn: string;
}

export interface MusicAlbum {
  name: string;
  type: "ep" | "album" | "artbook" | "digital";
  date: string;
}

export interface MusicLink {
  label: string;
  url: string;
}

export interface MusicData {
  playlistId: string;
  tracks: MusicTrack[];
  albums: MusicAlbum[];
  links: MusicLink[];
}

export function getMusic(): MusicData {
  const file = path.join(CONTENT_ROOT, "music.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as MusicData;
}
