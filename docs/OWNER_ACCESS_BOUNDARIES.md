# Owner Workspace Boundary

The owner/co-founder workspace belongs in `nashemann-admin`. Vendor admins remain tenant-scoped: `src/lib/dal.ts#getAdminUser` requires a signed-in user, a `profiles.role` of `admin` or `staff`, a non-null `vendor_id`, and an active vendor record. Owner membership does not satisfy those checks and must not grant vendor-admin access.

Rules:
- Do not add owner dashboard, platform-finance, governance, decision, or approval routes to the vendor admin.
- Keep vendor access tied to the user's own vendor profile and active vendor.
- Never infer vendor-admin privileges from `owner_memberships` or founder capabilities.
- Continue requiring MFA completion where an enrolled TOTP factor requires AAL2.

This document records the cross-repository boundary. Existing vendor-admin authentication and tenant checks remain unchanged.
