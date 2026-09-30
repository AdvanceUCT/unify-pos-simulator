import { isOperator } from "@/lib/operator";
import { Terminal } from "@/components/Terminal";
import { Login } from "@/components/Login";
export const dynamic = "force-dynamic";
export default async function TerminalPage() { return await isOperator() ? <Terminal /> : <Login />; }
