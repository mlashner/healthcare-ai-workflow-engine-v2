import { ToolError } from "./errors";
import type { Tool } from "./types";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  resolve(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  require(name: string): Tool {
    const tool = this.resolve(name);
    if (!tool) {
      throw new ToolError("UNKNOWN_TOOL", `unknown tool: ${name}`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }
}
