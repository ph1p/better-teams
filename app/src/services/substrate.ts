// SubstrateSearch: org-wide people suggestions, as used by Teams' powerbar
// @-picker. Different origin and bearer (aud SubstrateSearch) than chatsvc.
// Request shape verified against a live client (Nov 2026).

import { call, type Res } from "./http";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const PEOPLE_FIELDS = [
  "Id", "MRI", "DisplayName", "EmailAddresses", "PeopleType", "PeopleSubtype",
  "UserPrincipalName", "GivenName", "Surname", "CompanyName", "JobTitle",
  "ImAddress", "Department",
];

/** Raw People suggestions for `query`. `oid` anchors the request to the user's mailbox. */
export function suggestPeople(query: string, size: number, oid: string): Promise<Res> {
  const body = {
    EntityRequests: [
      {
        Query: { QueryString: query, DisplayQueryString: query, NormalizedQueryString: query },
        EntityType: "People",
        Size: size,
        Fields: PEOPLE_FIELDS,
        Filter: {
          And: [
            { Or: [{ Term: { PeopleType: "Person" } }, { Term: { PeopleType: "Other" } }] },
            {
              Or: [
                { Term: { PeopleSubtype: "OrganizationUser" } },
                { Term: { PeopleSubtype: "MTOUser" } },
                { Term: { PeopleSubtype: "PersonalContact" } },
                { Term: { PeopleSubtype: "Guest" } },
              ],
            },
            { Or: [{ Term: { Flags: "NonHidden" } }] },
          ],
        },
        Provenances: ["Mailbox", "Directory"],
        From: 0,
      },
    ],
    Scenario: {
      Name: "powerbar",
      Dimensions: [{ DimensionName: "QueryType", DimensionValue: "PeopleCentricSearch" }],
    },
    Cvid: uuid(),
    AppName: "Microsoft Teams",
    LogicalId: uuid(),
    dataSource: "personScoped",
  };
  return call(
    "substrate",
    "https://substrate.office.com/search/api/v1/suggestions" +
      "?scenario=powerbar&setflight=EnableMessageImageSearch,EnableTeamsChannelDomainPowerbar",
    {
      method: "POST",
      credentials: "include",
      headers: {
        ...(oid ? { "x-anchormailbox": "Oid:" + oid } : {}),
        "client-request-id": uuid(),
        "x-ms-session-id": uuid(),
        "x-client-version": "T2.1",
      },
      body,
    },
  );
}
