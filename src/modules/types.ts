export interface PatchEdit {
  path: string;
  before: string;
  after: string;
}
export interface FeatureModule {
  id: string;
  version: string;
  name: string;
  description: string;
  dependencies: string[];
  conflicts: string[];
  targets: string[];
  prepare(files: Map<string, string>): PatchEdit[];
  verify(files: Map<string, string>): boolean;
}
export interface QuotaBinding {
  target: string;
  profile: string;
  react: string;
  jsx: string;
  account: string;
  read: string;
  query: string;
  scopeHook: string;
  scope: string;
  guards: string[];
}
export interface Adapter {
  id: string;
  platform: "darwin" | "win32" | "linux";
  version: string;
  headerHash: string | null;
  status: "experimental" | "verified";
  files: Record<string, string>;
  nativeFiles?: Record<string, string>;
  quota?: QuotaBinding;
}
