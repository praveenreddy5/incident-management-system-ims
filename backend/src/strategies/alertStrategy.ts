import { Severity } from "@prisma/client";

export interface AlertStrategy {
  getSeverity(componentType: string): Severity;
}

class DefaultAlertStrategy implements AlertStrategy {
  getSeverity(componentType: string): Severity {
    const type = componentType.toUpperCase();

    if (type.includes("RDBMS") || type.includes("DATABASE")) return Severity.P0;
    if (type.includes("QUEUE")) return Severity.P1;
    if (type.includes("MCP")) return Severity.P1;
    if (type.includes("CACHE")) return Severity.P2;
    return Severity.P3;
  }
}

let currentStrategy: AlertStrategy = new DefaultAlertStrategy();

export const alertStrategy: AlertStrategy = {
  getSeverity(componentType: string): Severity {
    return currentStrategy.getSeverity(componentType);
  },
};

export function setAlertStrategy(strategy: AlertStrategy): void {
  currentStrategy = strategy;
}