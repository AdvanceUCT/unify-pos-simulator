import { refundOperationRoute } from "@/lib/refundOperationRoute";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return refundOperationRoute(request, (await context.params).id, "read"); }
