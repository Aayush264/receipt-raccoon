
export type SavedReceipt = {
  id: string;
  name: string;
  category: string;
  store: string;
  purchaseDate: string;
  price: number;
  warrantyDate: string;
  fileName: string;
  file: Blob;
  createdAt: number;
};

const DB_NAME = "receipt-raccoon";
const STORE_NAME = "receipts";

function openReceiptsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Could not open the database."));
    };
  });
}

export async function saveReceipt(
  receipt: SavedReceipt
): Promise<void> {
  const db = await openReceiptsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).put(receipt);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      const error = transaction.error;
      db.close();
      reject(error ?? new Error("Could not save the receipt."));
    };

    transaction.onabort = () => {
      const error = transaction.error;
      db.close();
      reject(error ?? new Error("Saving the receipt was cancelled."));
    };
  });
}

export async function getReceipts(): Promise<SavedReceipt[]> {
  const db = await openReceiptsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      const receipts = request.result as SavedReceipt[];

      receipts.sort((a, b) => b.createdAt - a.createdAt);

      db.close();
      resolve(receipts);
    };

    request.onerror = () => {
      const error = request.error;
      db.close();
      reject(error ?? new Error("Could not load your receipts."));
    };
  });
}


export async function deleteReceipt(id: string): Promise<void> {
  const db = await openReceiptsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).delete(id);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      const error = transaction.error;
      db.close();
      reject(error ?? new Error("Could not delete the receipt."));
    };

    transaction.onabort = () => {
      const error = transaction.error;
      db.close();
      reject(error ?? new Error("Deleting the receipt was cancelled."));
    };
  });
}

export async function deleteAllReceipts(): Promise<void> {
  const db = await openReceiptsDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.objectStore(STORE_NAME).clear();

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      const error = transaction.error;
      db.close();
      reject(error ?? new Error("Could not clear your documents."));
    };

    transaction.onabort = () => {
      const error = transaction.error;
      db.close();
      reject(error ?? new Error("Clearing your documents was cancelled."));
    };
  });
}

