// Profiles: mri -> { displayName, imageUri, email, … } from Teams' profile store.
import type { Profile } from "../types";
import { region } from "../services";
import { CURRENT_OID, getAll, open } from "./idb";
import { obj, str } from "./raw";

// Teams profile photo URL. Captured shape (cookie-auth, no bearer):
//   /api/mt/<mtRegion>/beta/users/<my-guid>/profilepicturev2/<target-mri>
// mtRegion differs from the chatsvc region (e.g. emea vs de); the service
// layer records it off Teams' own traffic. Only org users (8:orgid:) have photos.
export function profilePhotoUrl(mri: string): string {
  if (!CURRENT_OID || !mri || mri.indexOf("8:orgid:") !== 0) return "";
  return (
    `/api/mt/${region("mt")}/beta/users/${CURRENT_OID}/profilepicturev2/` +
    encodeURIComponent(mri)
  );
}

let PROFILES: Record<string, Profile> = {};
export async function loadProfiles(): Promise<Record<string, Profile>> {
  try {
    const db = await open("profiles");
    const rows = await getAll(db, "profiles", 10000);
    const map: Record<string, Profile> = {};
    for (const row of rows) {
      const p = obj(row);
      const objectId = str(p.objectId);
      const key = str(p.mri) || (objectId ? "8:orgid:" + objectId : str(p.id));
      if (!key) continue;
      map[key] = {
        displayName: str(p.displayName) || [str(p.givenName), str(p.surname)].filter(Boolean).join(" ") || "",
        imageUri: str(p.imageUri),
        email: str(p.$$email) || str(p.userPrincipalName) || str(p.email),
        jobTitle: str(p.jobTitle) || str(p.title),
        department: str(p.department),
        officeLocation: str(p.officeLocation) || str(p.physicalDeliveryOfficeName),
        ...(str(p.developer) ? { developer: str(p.developer) } : {}),
      };
    }
    PROFILES = map;
  } catch {
    /* profiles optional */
  }
  return PROFILES;
}

const EMPTY_PROFILE: Profile = {
  displayName: "", imageUri: "", email: "", jobTitle: "", department: "", officeLocation: "",
};
export function profile(mri: string): Profile {
  return PROFILES[mri] || EMPTY_PROFILE;
}
