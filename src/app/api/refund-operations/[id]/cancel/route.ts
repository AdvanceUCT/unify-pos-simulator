import { refundOperationRoute } from "@/lib/refundOperationRoute";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return refundOperationRoute(request, (await context.params).id, "cancel"); }
