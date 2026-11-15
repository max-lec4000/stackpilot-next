import type { ReactNode } from "react";
import { problemGuidance } from "../../../packages/domain/problem-guidance.js";
export function Problem({ message, children }: { message: string; children?: ReactNode }) {
  const guidance = problemGuidance(message);
  return <div className="problem" role="alert">
    <b>{guidance.title}</b><p>{message}</p><p className="muted">{guidance.next}</p>
    <div className="button-group">{children}<a href={guidance.target}>Passenden Bereich öffnen</a></div>
  </div>;
}
