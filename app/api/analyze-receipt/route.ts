const receiptSchema = {
  type: "object",
  properties: {
    product_name: { type: "string" },
    category: { type: "string" },
    store: { type: "string" },
    purchase_date: { type: "string" },
    amount: { type: ["number", "null"] },
    warranty_expiry_date: { type: "string" },
  },
  required: [
    "product_name",
    "category",
    "store",
    "purchase_date",
    "amount",
    "warranty_expiry_date",
  ],
  additionalProperties: false,
};

export async function POST(request: Request) {
  // Step 1: Read the image sent by our website.

    const ollamaBaseUrl = process.env.OLLAMA_BASE_URL
    ?.trim()
    .replace(/\/+$/, "");

  if (process.env.VERCEL && !ollamaBaseUrl) {
    return Response.json(
      {
        error:
          "AI receipt reading is available when running Receipt Raccoon locally with Ollama. The hosted demo supports document management, but AI is not enabled here.",
      },
      { status: 503 }
    );
  }

  let body: { imageBase64?: string; mimeType?: string };

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "The request did not contain valid JSON." },
      { status: 400 }
    );
  }

  const { imageBase64, mimeType } = body;

  if (
    typeof imageBase64 !== "string" ||
    imageBase64.length === 0 ||
    typeof mimeType !== "string"
  ) {
    return Response.json(
      { error: "Please provide a receipt image." },
      { status: 400 }
    );
  }

  // Step 2: Accept only common image formats for this first version.
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!allowedTypes.includes(mimeType)) {
    return Response.json(
      { error: "For AI extraction, use a JPG, PNG, or WebP image." },
      { status: 400 }
    );
  }

  const imageSize = Buffer.from(imageBase64, "base64").byteLength;

  if (imageSize > 8 * 1024 * 1024) {
    return Response.json(
      { error: "Please use an image smaller than 8 MB." },
      { status: 413 }
    );
  }

  // Step 3: Ask Gemma to read the receipt using our local Ollama server.
  let ollamaResponse: Response;

  try {
    ollamaResponse = await fetch(
      `${ollamaBaseUrl ?? "http://127.0.0.1:11434"}/api/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemma3:4b",
          stream: false,
          format: receiptSchema,
          options: {
            temperature: 0,
          },
          messages: [
            {
              role: "user",
              content: [
                "Read the attached purchase receipt or bill.",
                "Extract the product name, category, seller, purchase date,",
                "total amount paid, and warranty expiry date.",
                "Return dates in YYYY-MM-DD format.",
                "Use an empty string for details you cannot read.",
                "Use null for the amount if it is not visible.",
                "Do not invent missing information.",
                "Only provide an explicit warranty expiry date if the bill",
                "states it. Do not guess one from the warranty duration.",
                "Return only the requested structured fields.",
              ].join(" "),
              images: [imageBase64],
            },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
        cache: "no-store",
      }
    );
  } catch {
    return Response.json(
      {
        error:
          "Could not reach local Ollama. Make sure Ollama is running and gemma3:4b is installed.",
      },
      { status: 502 }
    );
  }

  // Step 4: Check whether Ollama processed the image successfully.
  if (!ollamaResponse.ok) {
    return Response.json(
      {
        error:
          "Ollama could not analyze this image. Check that Gemma is available and try again.",
      },
      { status: 502 }
    );
  }

  let result: {
    message?: {
      content?: string;
    };
  };

  try {
    result = await ollamaResponse.json();
  } catch {
    return Response.json(
      { error: "Ollama returned an unreadable response." },
      { status: 502 }
    );
  }

  // Step 5: Convert the AI response from JSON text into usable data.
  try {
    const extracted = JSON.parse(
      result.message?.content ?? ""
    );

    const receipt = {
      product_name:
        typeof extracted.product_name === "string"
          ? extracted.product_name
          : "",
      category:
        typeof extracted.category === "string"
          ? extracted.category
          : "Other",
      store:
        typeof extracted.store === "string"
          ? extracted.store
          : "",
      purchase_date:
        typeof extracted.purchase_date === "string"
          ? extracted.purchase_date
          : "",
      amount:
        typeof extracted.amount === "number" &&
        Number.isFinite(extracted.amount) &&
        extracted.amount >= 0
          ? extracted.amount
          : null,
      warranty_expiry_date:
        typeof extracted.warranty_expiry_date === "string"
          ? extracted.warranty_expiry_date
          : "",
    };

    return Response.json({ receipt });
  } catch {
    return Response.json(
      {
        error:
          "The AI could not read this receipt clearly. Try a sharper, well-lit image.",
      },
      { status: 502 }
    );
  }
}
