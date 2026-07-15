import type { UIExtension } from "./types.js";

export class UIExtensionRegistry {
  private extensions: UIExtension[] = [];

  register(ext: UIExtension): void {
    this.extensions = this.extensions.filter(e => e.id !== ext.id);
    this.extensions.push(ext);
  }

  unregister(id: string): void {
    this.extensions = this.extensions.filter(e => e.id !== id);
  }

  list(): UIExtension[] {
    return [...this.extensions];
  }

  listByType(type: string): UIExtension[] {
    return this.extensions.filter(e => e.type === type);
  }

  get count(): number { return this.extensions.length; }

  clear(): void { this.extensions = []; }
}
