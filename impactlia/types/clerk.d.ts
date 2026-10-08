export {};

declare global {
  // Claims added to the session token in the Clerk dashboard
  // (Sessions → Customize session token).
  interface CustomJwtSessionClaims {
    org_name?: string;
  }
}
