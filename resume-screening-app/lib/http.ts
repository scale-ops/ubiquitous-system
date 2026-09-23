import { NextResponse } from "next/server";

// Wraps an API route so any error comes back as readable JSON instead of a blank 500 page.
export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
