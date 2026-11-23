// Profiles: mri -> { displayName, imageUri, email, … } from Teams' profile store.
import type { Profile } from "../types";
import { isConsumer, region } from "../services";
import { CURRENT_OID, getAll, open } from "./idb";
import { obj, str } from "./raw";

// Teams profile photo URL. Captured shape (cookie-auth, no bearer):
//   /api/mt/<mtRegion>/beta/users/<my-guid>/profilepicturev2/<target-mri>
// mtRegion differs from the chatsvc region (e.g. emea vs de); the service
// layer records it off Teams' own traffic. Only org users (8:orgid:) have photos.
// Personal (teams.live.com) accounts use /api/mt/beta/users/<target-mri>/profilepicturev2
// instead: no region, no own id, and any "8:" user can have one. It 404s
// without `displayname` (used for the initials image when there is no photo).
export function profilePhotoUrl(mri: string): string {
  if (isConsumer()) return mri.startsWith("8:") ? PROFILES[mri]?.imageUri || consumerPhoto(mri, "", "") : "";
  if (!CURRENT_OID || !mri || mri.indexOf("8:orgid:") !== 0) return "";
  return `/api/mt/${region("mt")}/beta/users/${CURRENT_OID}/profilepicturev2/` + encodeURIComponent(mri);
}

// Consumer profile rows carry the raw photo source (substrate or
// avatar.skype.com), which the page cannot load itself; Teams hands it to the mt
// proxy as `imageUri`, as captured here.
function consumerPhoto(mri: string, name: string, source: string): string {
  const q = new URLSearchParams({ displayname: name || mri.slice(2) });
  if (source) q.set("imageUri", source);
  q.set("size", "HR96x96");
  return `/api/mt/beta/users/${mri}/profilepicturev2?${q}`;
}

let PROFILES: Record<string, Profile> = {};
export async function loadProfiles(): Promise<Record<string, Profile>> {
  try {
    const db = await open("profiles");
    const rows = await getAll(db, "profiles", 10000);
    const map: Record<string, Profile> = {};
    const consumer = isConsumer();
    for (const row of rows) {
      const p = obj(row);
      const objectId = str(p.objectId);
      const key = str(p.mri) || (objectId ? "8:orgid:" + objectId : str(p.id));
      if (!key) continue;
      const displayName = str(p.displayName) || [str(p.givenName), str(p.surname)].filter(Boolean).join(" ") || "";
      map[key] = {
        displayName,
        imageUri: consumer && key.startsWith("8:") ? consumerPhoto(key, displayName, str(p.imageUri)) : str(p.imageUri),
        email: str(p.$$email) || str(p.userPrincipalName) || str(p.email),
        jobTitle: str(p.jobTitle) || str(p.title),
        department: str(p.department),
        officeLocation: str(p.officeLocation) || str(p.physicalDeliveryOfficeName),
        ...(str(p.developer) ? { developer: str(p.developer) } : {}),
        ...(str(p.givenName) ? { givenName: str(p.givenName) } : {}),
        ...(str(p.surname) ? { surname: str(p.surname) } : {}),
      };
    }
    PROFILES = map;
  } catch {
    /* profiles optional */
  }
  return PROFILES;
}

const EMPTY_PROFILE: Profile = {
  displayName: "",
  imageUri: "",
  email: "",
  jobTitle: "",
  department: "",
  officeLocation: "",
};
export function profile(mri: string): Profile {
  return PROFILES[mri] || EMPTY_PROFILE;
}
