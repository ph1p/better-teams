// Teams apps (bots: Jira, Workflows, Copilot, …) live in the 28: MRI space,
// sometimes suffixed ":appId:<guid>". They post cards and can be messaged, but
// cannot be called and have no presence or people profile.
export const isAppMri = (mri: string) => mri.startsWith("28:");
