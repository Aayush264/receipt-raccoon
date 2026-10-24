
import type { SavedReceipt } from "./receipts";

const BACKUP_FORMAT = "receipt-raccoon-backup";
const BACKUP_VERSION = 1;

type BackupReceipt = Omit<SavedReceipt, "file"> & {
  fileType: string;
  fileDataUrl: string;
};

type BackupData = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  receipts: BackupReceipt[];
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not prepare a document for backup."));
      }
    };

    reader.onerror = () => {
      reject(new Error("Could not read a document for backup."));
    };

    reader.readAsDataURL(blob);
  });
}

export async function createBackupBlob(
  receipts: SavedReceipt[]
): Promise<Blob> {
  const backupReceipts = await Promise.all(
    receipts.map(async (receipt): Promise<BackupReceipt> => {
      const { file, ...details } = receipt;

      return {
        ...details,
        fileType: file.type || "application/octet-stream",
        fileDataUrl: await blobToDataUrl(file),
      };
    })
  );

  const backup: BackupData = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    receipts: backupReceipts,
  };

  return new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );
}

export async function parseBackupFile(
  file: File
): Promise<SavedReceipt[]> {
  const text = await file.text();

  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid backup JSON.");
  }

  if (
    !data ||
    typeof data !== "object" ||
    !("format" in data) ||
    !("version" in data) ||
    !("receipts" in data) ||
    data.format !== BACKUP_FORMAT ||
    data.version !== BACKUP_VERSION ||
    !Array.isArray(data.receipts)
  ) {
    throw new Error(
      "This is not a supported Receipt Raccoon backup."
    );
  }

  const restoredReceipts: SavedReceipt[] = [];

  for (const item of data.receipts) {
    if (
      !item ||
      typeof item !== "object" ||
      !("id" in item) ||
      !("name" in item) ||
      !("category" in item) ||
      !("store" in item) ||
      !("purchaseDate" in item) ||
      !("price" in item) ||
      !("warrantyDate" in item) ||
      !("fileName" in item) ||
      !("createdAt" in item) ||
      !("fileType" in item) ||
      !("fileDataUrl" in item)
    ) {
      throw new Error(
        "A receipt in this backup is missing required fields."
      );
    }

    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.category !== "string" ||
      typeof item.store !== "string" ||
      typeof item.purchaseDate !== "string" ||
      typeof item.price !== "number" ||
      !Number.isFinite(item.price) ||
      item.price < 0 ||
      typeof item.warrantyDate !== "string" ||
      typeof item.fileName !== "string" ||
      typeof item.createdAt !== "number" ||
      !Number.isFinite(item.createdAt) ||
      typeof item.fileType !== "string" ||
      typeof item.fileDataUrl !== "string"
    ) {
      throw new Error(
        "A receipt in this backup contains invalid data."
      );
    }

    const match = /^data:([^;,]+)?;base64,([\s\S]*)$/.exec(
      item.fileDataUrl
    );

    if (!match) {
      throw new Error(
        "An original document in this backup is invalid."
      );
    }

    let binary: string;

    try {
      binary = atob(match[2]);
    } catch {
      throw new Error(
        "Could not decode an original document in this backup."
      );
    }

    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }

    const restoredFile = new Blob([bytes], {
      type: item.fileType || match[1] || "application/octet-stream",
    });

    restoredReceipts.push({
      id: item.id,
      name: item.name,
      category: item.category,
      store: item.store,
      purchaseDate: item.purchaseDate,
      price: item.price,
      warrantyDate: item.warrantyDate,
      fileName: item.fileName,
      file: restoredFile,
      createdAt: item.createdAt,
    });
  }

  return restoredReceipts;
}
