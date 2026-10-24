
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  getReceipts,
  saveReceipt,
  deleteReceipt,
  deleteAllReceipts,
  type SavedReceipt,
} from "../lib/receipts";
import { createBackupBlob, parseBackupFile } from "../lib/backup";

type ReceiptStatus = "Active" | "Ending soon" | "Expired" | "No warranty date";

type DisplayReceipt = {
  id: string;
  name: string;
  category: string;
  store: string;
  date: string;
  price: string;
  icon: string;
  warranty: string;
  warrantyISO: string;
  status: ReceiptStatus;
  file?: Blob;
  fileName?: string;
};

function formatDate(value: string) {
  if (!value) return "Not provided";

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDaysRemaining(value: string, todayISO: string): number | null {
  if (
    !value ||
    !todayISO ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(todayISO)
  ) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = todayISO.split("-").map(Number);

  function isValidCalendarDate(y: number, m: number, d: number) {
    if (m < 1 || m > 12 || d < 1) return false;

    const leapYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const daysInMonth = [
      31,
      leapYear ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];

    return d <= daysInMonth[m - 1];
  }

  if (
    !isValidCalendarDate(year, month, day) ||
    !isValidCalendarDate(todayYear, todayMonth, todayDay)
  ) {
    return null;
  }

  // Use a date supplied after the component mounts, not the current time during render.
  const todayUTC = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const expiryUTC = Date.UTC(year, month - 1, day);

  return Math.round((expiryUTC - todayUTC) / 86_400_000);
}

function getWarrantyStatus(value: string, todayISO: string): ReceiptStatus {
  const daysRemaining = getDaysRemaining(value, todayISO);

  if (daysRemaining === null) return "No warranty date";
  if (daysRemaining < 0) return "Expired";
  if (daysRemaining <= 30) return "Ending soon";

  return "Active";
}

function normalizeForComparison(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findDuplicateReceipts(
  newReceipt: {
    name: string;
    store: string;
    purchaseDate: string;
    price: number;
  },
  existingReceipts: SavedReceipt[]
) {
  const newName = normalizeForComparison(newReceipt.name);
  const newStore = normalizeForComparison(newReceipt.store);

  return existingReceipts.filter((receipt) => {
    const existingName = normalizeForComparison(receipt.name);
    const existingStore = normalizeForComparison(receipt.store);
    const sameName = newName !== "" && newName === existingName;
    const sameStore = newStore !== "" && existingStore !== "" && newStore === existingStore;
    const sameDate = newReceipt.purchaseDate !== "" && newReceipt.purchaseDate === receipt.purchaseDate;
    const samePrice = Math.abs(newReceipt.price - receipt.price) < 0.01;

    return sameName && ((sameStore && (sameDate || samePrice)) || (sameDate && samePrice));
  });
}

function getCategoryIcon(category: string) {
  const value = category.toLowerCase();

  if (value.includes("phone") || value.includes("electronic")) return "📱";
  if (value.includes("home") || value.includes("appliance")) return "🏠";
  if (value.includes("kitchen")) return "🍳";
  if (value.includes("computer")) return "💻";
  if (value.includes("furniture")) return "🪑";

  return "🧾";
}

function toDisplayReceipt(
  receipt: SavedReceipt,
  todayISO: string
): DisplayReceipt {
  return {
    id: receipt.id,
    name: receipt.name,
    category: receipt.category || "Other",
    store: receipt.store || "Store not specified",
    date: formatDate(receipt.purchaseDate),
    price: receipt.price.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }),
    icon: getCategoryIcon(receipt.category),
    warranty: formatDate(receipt.warrantyDate),
    warrantyISO: receipt.warrantyDate,
    status: getWarrantyStatus(receipt.warrantyDate, todayISO),
    file: receipt.file,
    fileName: receipt.fileName,
  };
}

export default function Home() {
  const [receipts, setReceipts] = useState<SavedReceipt[]>([]);
  const [todayISO, setTodayISO] = useState("");
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [duplicateReceipts, setDuplicateReceipts] = useState<SavedReceipt[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<SavedReceipt | null>(null);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [deletingAllReceipts, setDeletingAllReceipts] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiMatchedIds, setAiMatchedIds] = useState<string[] | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Electronics");
  const [store, setStore] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [price, setPrice] = useState("");
  const [warrantyDate, setWarrantyDate] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Set the current local calendar date only after hydration to avoid
    // Next.js prerender errors from reading the clock during render.
    const now = new Date();
    const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setTodayISO(localToday);

    let cancelled = false;

    getReceipts()
      .then((items) => {
        if (!cancelled) setReceipts(items);
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage(
            "Could not open local storage. Try refreshing this page."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const realReceipts = useMemo(
    () => receipts.map((receipt) => toDisplayReceipt(receipt, todayISO)),
    [receipts, todayISO]
  );
  // Only show receipts actually saved by the user. No demo bills.
  const sourceReceipts = realReceipts;

  const filteredReceipts = useMemo(() => {
    const term = search.toLowerCase().trim();

    return sourceReceipts.filter((receipt) =>
      [
        receipt.name,
        receipt.category,
        receipt.store,
        receipt.date,
      ].some((value) => value.toLowerCase().includes(term))
    );
  }, [search, sourceReceipts]);

  const visibleReceipts = useMemo(() => {
    if (aiMatchedIds === null) {
      return filteredReceipts;
    }

    const matchedIds = new Set(aiMatchedIds);
    return filteredReceipts.filter((receipt) => matchedIds.has(receipt.id));
  }, [aiMatchedIds, filteredReceipts]);

  const warrantyReceipts = useMemo(() => {
    return sourceReceipts
      .map((receipt) => ({
        ...receipt,
        daysRemaining: getDaysRemaining(receipt.warrantyISO, todayISO),
      }))
      .filter((receipt) => receipt.daysRemaining !== null)
      .sort((a, b) => a.daysRemaining! - b.daysRemaining!);
  }, [sourceReceipts, todayISO]);
  const activeCount = realReceipts.filter(
    (receipt) => receipt.status === "Active"
  ).length;

  const endingSoonCount = realReceipts.filter(
    (receipt) => receipt.status === "Ending soon"
  ).length;

  async function handleDeleteReceipt(receipt: DisplayReceipt) {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${receipt.name}"? This cannot be undone unless you have a backup.`
    );
    if (!confirmed) return;

    setDeletingReceiptId(receipt.id);
    setErrorMessage("");
    setStatusMessage("");

    try {
      await deleteReceipt(receipt.id);
      setReceipts((current) => current.filter((item) => item.id !== receipt.id));
      setAiMatchedIds(null);
      setAiAnswer("");
      setStatusMessage(`"${receipt.name}" was deleted.`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not delete this receipt. Please try again."
      );
    } finally {
      setDeletingReceiptId(null);
    }
  }

  async function handleDeleteAllReceipts() {
    if (receipts.length === 0) {
      setStatusMessage("There are no saved documents to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete all ${receipts.length} saved document(s)? This cannot be undone unless you have a backup.`
    );
    if (!confirmed) return;

    setDeletingAllReceipts(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      await deleteAllReceipts();
      setReceipts([]);
      setAiMatchedIds(null);
      setAiAnswer("");
      setStatusMessage("All saved documents have been deleted.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not clear your documents. Please try again."
      );
    } finally {
      setDeletingAllReceipts(false);
    }
  }

  function openFilePicker() {
    fileInput.current?.click();
  }

  async function handleDownloadBackup() {
    setErrorMessage("");
    setStatusMessage("");

    if (receipts.length === 0) {
      setStatusMessage("No saved receipts to back up yet.");
      return;
    }

    setCreatingBackup(true);

    try {
      const backupBlob = await createBackupBlob(receipts);
      const url = URL.createObjectURL(backupBlob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);

      link.href = url;
      link.download = `receipt-raccoon-backup-${date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setStatusMessage(
        `Backup downloaded successfully. It contains ${receipts.length} saved receipt(s). Keep this file somewhere safe.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not create the backup."
      );
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handleRestoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";

    if (!file) return;

    setErrorMessage("");
    setStatusMessage("");

    if (file.size > 100 * 1024 * 1024) {
      setErrorMessage("This backup is larger than 100 MB.");
      return;
    }

    const confirmed = window.confirm(
      "Restore receipts from this backup? Records with matching IDs will be updated. Other saved receipts will be kept."
    );

    if (!confirmed) return;

    setRestoringBackup(true);

    try {
      const importedReceipts = await parseBackupFile(file);

      if (importedReceipts.length > 10000) {
        throw new Error("This backup contains too many receipts to restore safely.");
      }

      for (const receipt of importedReceipts) {
        await saveReceipt(receipt);
      }

      const updatedReceipts = await getReceipts();
      setReceipts(updatedReceipts);
      setAiMatchedIds(null);
      setAiAnswer("");

      setStatusMessage(
        `Restore complete. Processed ${importedReceipts.length} receipt(s). Your other saved receipts were kept.`
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not restore this backup."
      );
    } finally {
      setRestoringBackup(false);
    }
  }

  async function handleAiSearch(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  const query = aiQuery.trim();

  if (!query) {
    setAiAnswer("Please type a question about your saved bills.");
    return;
  }

  setAiSearching(true);
  setAiAnswer("");
  setAiMatchedIds(null);

  try {
    const response = await fetch("/api/search-receipts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        receipts: sourceReceipts.slice(0, 100).map((receipt) => ({
          id: receipt.id,
          name: receipt.name,
          category: receipt.category,
          store: receipt.store,
          date: receipt.date,
          price: receipt.price,
          warranty: receipt.warranty,
        })),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "AI search failed. Please try again.");
    }

    const availableIds = new Set(
      sourceReceipts.slice(0, 100).map((receipt) => receipt.id)
    );

    const matchedIds: string[] = Array.isArray(data.matchedIds)
      ? data.matchedIds.filter(
          (id: unknown): id is string =>
            typeof id === "string" && availableIds.has(id)
        )
      : [];

    setAiMatchedIds(matchedIds);
    setAiAnswer(
      typeof data.answer === "string"
        ? data.answer
        : `Found ${matchedIds.length} matching receipt(s).`
    );
  } catch (error) {
    setAiMatchedIds(null);
    setAiAnswer(
      error instanceof Error
        ? error.message
        : "Could not search your bills. Please try again."
    );
  } finally {
    setAiSearching(false);
  }
}

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (
      file.type !== "application/pdf" &&
      !file.type.startsWith("image/")
    ) {
      setErrorMessage("Please select a PDF or image file.");
      return;
    }

    setErrorMessage("");
    setStatusMessage("");
    setSelectedFile(file);
    setShowForm(true);
  }

  
  async function handleAnalyzeReceipt() {
  if (!selectedFile) {
    setErrorMessage("Please select a receipt image first.");
    return;
  }

  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  if (!supportedTypes.includes(selectedFile.type)) {
    setErrorMessage(
      "AI reading currently supports JPG, PNG, and WebP images. PDFs can still be entered manually."
    );
    return;
  }

  if (selectedFile.size > 8 * 1024 * 1024) {
    setErrorMessage("Please choose an image smaller than 8 MB.");
    return;
  }

  setAnalyzing(true);
  setErrorMessage("");
  setStatusMessage("");

  try {
    // Read the image and convert it to Base64.
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
        } else {
          reject(new Error("Could not read the image."));
        }
      };

      reader.onerror = () => {
        reject(new Error("Could not read the selected image."));
      };

      reader.readAsDataURL(selectedFile);
    });

    const imageBase64 = dataUrl.split(",")[1];

    if (!imageBase64) {
      throw new Error("Could not prepare the image for AI analysis.");
    }

    // Send the image to our local Next.js endpoint.
    const response = await fetch("/api/analyze-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageBase64,
        mimeType: selectedFile.type,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Receipt analysis failed.");
    }

    const extracted = data.receipt;

    if (!extracted) {
      throw new Error("The AI did not return receipt details.");
    }

    // Fill in the form using the AI's results.
    setName(
      typeof extracted.product_name === "string"
        ? extracted.product_name
        : ""
    );

    setStore(
      typeof extracted.store === "string"
        ? extracted.store
        : ""
    );

    const modelCategory = String(
      extracted.category ?? ""
    ).toLowerCase();

    let nextCategory = "Other";

    if (modelCategory.includes("kitchen")) {
      nextCategory = "Kitchen appliances";
    } else if (
      modelCategory.includes("home") ||
      modelCategory.includes("appliance")
    ) {
      nextCategory = "Home appliances";
    } else if (
      modelCategory.includes("phone") ||
      modelCategory.includes("mobile")
    ) {
      nextCategory = "Mobile phones";
    } else if (
      modelCategory.includes("computer") ||
      modelCategory.includes("laptop")
    ) {
      nextCategory = "Computers";
    } else if (modelCategory.includes("furniture")) {
      nextCategory = "Furniture";
    } else if (modelCategory.includes("cloth")) {
      nextCategory = "Clothing";
    } else if (modelCategory.includes("electronic")) {
      nextCategory = "Electronics";
    }

    setCategory(nextCategory);

    const purchaseDate = extracted.purchase_date;
    setPurchaseDate(
      typeof purchaseDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)
        ? purchaseDate
        : ""
    );

    setPrice(
      typeof extracted.amount === "number"
        ? String(extracted.amount)
        : ""
    );

    const warrantyDate = extracted.warranty_expiry_date;
    setWarrantyDate(
      typeof warrantyDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(warrantyDate)
        ? warrantyDate
        : ""
    );

    setStatusMessage(
      "AI analysis complete! Please check the extracted details against your original bill."
    );
  } catch (error) {
    setErrorMessage(
      error instanceof Error
        ? error.message
        : "Something went wrong during AI analysis."
    );
  } finally {
    setAnalyzing(false);
  }
}

  function cancelForm() {
    setShowForm(false);
    setSelectedFile(null);
    setName("");
    setCategory("Electronics");
    setStore("");
    setPurchaseDate("");
    setPrice("");
    setWarrantyDate("");
    setErrorMessage("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");

    if (!selectedFile) {
      setErrorMessage("Please choose a receipt or warranty document.");
      return;
    }

    if (!Number.isFinite(Number(price)) || Number(price) < 0) {
      setErrorMessage("Please enter a valid bill amount.");
      return;
    }

    const newReceipt: SavedReceipt = {
      id: crypto.randomUUID(),
      name: name.trim(),
      category,
      store: store.trim(),
      purchaseDate,
      price: Number(price),
      warrantyDate,
      fileName: selectedFile.name,
      file: selectedFile,
      createdAt: Date.now(),
    };

    const duplicates = findDuplicateReceipts(newReceipt, receipts);
    if (duplicates.length > 0) {
      setPendingReceipt(newReceipt);
      setDuplicateReceipts(duplicates);
      setShowDuplicateWarning(true);
      return;
    }

    await saveNewReceipt(newReceipt);
  }

  async function saveNewReceipt(receipt: SavedReceipt) {
    setSaving(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      await saveReceipt(receipt);
      setReceipts((current) => [receipt, ...current]);
      setShowDuplicateWarning(false);
      setDuplicateReceipts([]);
      setPendingReceipt(null);
      cancelForm();
      setStatusMessage("Your bill and details have been saved on this device.");
    } catch {
      setErrorMessage(
        "We could not save this bill. Check your browser storage and try again."
      );
    } finally {
      setSaving(false);
    }
  }

  function openOriginal(receipt: DisplayReceipt) {
    if (!receipt.file) return;

    const url = URL.createObjectURL(receipt.file);
    const link = document.createElement("a");

    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-icon">🦝</span>
          <span>
            <strong>receipt raccoon</strong>
            <small>Your family&apos;s bill box</small>
          </span>
        </a>

        <p className="nav-label">WORKSPACE</p>

        <nav className="navigation">
          <a className="nav-link active" href="#overview">
            <span>◫</span> Overview
          </a>
          <a className="nav-link" href="#documents">
            <span>▤</span> My documents
          </a>
          <a className="nav-link" href="#warranties">
            <span>◷</span> Warranty tracker
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-icon">⌑</div>
          <strong>Your documents, your control.</strong>
          <p>
            Your saved receipts stay in this browser on this device.
          </p>
          <span className="free-label">✳ FREE &amp; LOCAL STORAGE</span>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="topbar-intro">
            <p className="eyebrow">YOUR EVERYDAY ESSENTIALS, SAFELY STORED</p>
            <h1>
              Your receipts,
              <br className="heading-break" />
              <span className="heading-highlight">all in one place.</span>
              <span className="heading-sparkle" aria-hidden="true"> ✳</span>
            </h1>
            <p className="page-subtitle">
              Find bills faster, keep warranties in view, and stay organized.
            </p>
          </div>

          <div className="topbar-actions">
            <button
              type="button"
              className="backup-button"
              onClick={handleDownloadBackup}
              disabled={creatingBackup || restoringBackup || loading}
            >
              {creatingBackup ? "Preparing backup..." : "↓ Download backup"}
            </button>

            <button
              type="button"
              className="backup-button"
              onClick={() => backupFileInput.current?.click()}
              disabled={creatingBackup || restoringBackup || loading}
            >
              {restoringBackup ? "Restoring..." : "↑ Restore backup"}
            </button>

            <button className="primary-button" onClick={openFilePicker}>
              <span>＋</span> Add a bill
            </button>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf,.pdf"
            hidden
            onChange={handleFileChange}
          />

          <input
            ref={backupFileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={handleRestoreBackup}
          />
        </header>

        <div className="content">
          <section className="hero-card" id="overview">
            <div className="hero-copy">
              <span className="hero-tag">A LITTLE LESS PAPER CHAOS</span>
              <h2>
                Every bill remembered.
                <br />
                <em>Nothing lost in the pile.</em>
              </h2>
              <p>
                Keep receipts, invoices and warranty cards together,
                so the bill you need is never buried in a drawer again.
              </p>
              <button className="hero-button" onClick={openFilePicker}>
                Bring in a bill <span>↗</span>
              </button>
            </div>

            <div className="hero-art" aria-hidden="true">
              <div className="receipt-paper paper-back">
                <span>WARRANTY CARD</span>
                <div />
                <div />
                <div />
              </div>
              <div className="receipt-paper paper-front">
                <span>YOUR RECEIPT</span>
                <div />
                <div />
                <div />
                <strong>✓ SAVED</strong>
              </div>
              <div className="raccoon-face">🦝</div>
              <span className="sparkle sparkle-one">✳</span>
              <span className="sparkle sparkle-two">✦</span>
            </div>
          </section>

          {statusMessage && (
            <div className="success-notice" role="status">
              <span>✓</span> {statusMessage}
            </div>
          )}

          {errorMessage && (
            <div className="error-notice" role="alert">
              {errorMessage}
            </div>
          )}

          {showForm && (
            <section className="add-form-panel">
              <div className="add-form-heading">
                <div>
                  <p className="eyebrow">NEW DOCUMENT</p>
                  <h2>Let's save this bill</h2>
                  <p>
                    Use Read with AI to fill in details, then review everything
                    against the original bill before saving.
                  </p>
                </div>
                <button
                  type="button"
                  className="cancel-button"
                  onClick={cancelForm}
                >
                  Cancel
                </button>
              </div>

              <div className="selected-file">
                <span>📄</span>
                <div>
                  <strong>{selectedFile?.name}</strong>
                  <small>
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(1)} KB · Stored with this receipt`
                      : ""}
                  </small>
                </div>
                <button type="button" onClick={openFilePicker}>
                  Change file
                </button>
                <button
                  type="button"
                  className="ai-button"
                  onClick={handleAnalyzeReceipt}
                  disabled={analyzing}
                >
                  {analyzing ? "Reading receipt..." : "✨ Read with AI"}
                </button>
              </div>

              <form className="receipt-form" onSubmit={handleSave}>
                <label>
                  Product or item name *
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Samsung refrigerator"
                    required
                    maxLength={120}
                  />
                </label>

                <label>
                  Category *
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    required
                  >
                    <option>Electronics</option>
                    <option>Home appliances</option>
                    <option>Mobile phones</option>
                    <option>Kitchen appliances</option>
                    <option>Computers</option>
                    <option>Furniture</option>
                    <option>Clothing</option>
                    <option>Other</option>
                  </select>
                </label>

                <label>
                  Store or seller
                  <input
                    value={store}
                    onChange={(event) => setStore(event.target.value)}
                    placeholder="e.g. Reliance Digital"
                    maxLength={120}
                  />
                </label>

                <label>
                  Purchase date *
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(event) => setPurchaseDate(event.target.value)}
                    required
                  />
                </label>

                <label>
                  Bill amount (₹) *
                  <input
                    type="number"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="e.g. 29990"
                    min="0"
                    step="0.01"
                    required
                  />
                </label>

                <label>
                  Warranty expiry date
                  <input
                    type="date"
                    value={warrantyDate}
                    onChange={(event) => setWarrantyDate(event.target.value)}
                  />
                </label>

                <div className="form-actions">
                  <p>* Required fields</p>
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={cancelForm}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save my bill"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {showDuplicateWarning && pendingReceipt && (
            <div className="duplicate-warning">
              <h2>⚠️ Possible Duplicate Receipt</h2>
              <p>We found a receipt that looks similar to the one you are adding. Please check before saving.</p>
              <div className="duplicate-receipt-list">
                {duplicateReceipts.map((receipt) => (
                  <div key={receipt.id} className="duplicate-receipt-item">
                    <strong>{receipt.name}</strong>
                    <p>Store: {receipt.store || "Not provided"}</p>
                    <p>Purchase date: {receipt.purchaseDate || "Not provided"}</p>
                    <p>Amount: ₹{receipt.price.toFixed(2)}</p>
                  </div>
                ))}
              </div>
              <div className="duplicate-warning-actions">
                <button type="button" onClick={() => {
                  setShowDuplicateWarning(false);
                  setDuplicateReceipts([]);
                  setPendingReceipt(null);
                }}>Cancel</button>
                <button type="button" onClick={() => {
                  if (pendingReceipt) void saveNewReceipt(pendingReceipt);
                }} disabled={saving}>
                  {saving ? "Saving..." : "Save Anyway"}
                </button>
              </div>
            </div>
          )}

          <div className="section-heading">
            <div>
              <h2>Your little overview</h2>
              <p>Your saved documents, all in one place.</p>
            </div>
            <span className="demo-badge">YOUR DOCUMENTS</span>
          </div>

          <section className="stats-grid">
            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon green">▤</span>
                <span className="stat-note">Saved on this device</span>
              </div>
              <strong className="stat-number">
                {String(receipts.length).padStart(2, "0")}
              </strong>
              <span className="stat-description">Saved documents</span>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon blue">◷</span>
                <span className="stat-note">Not expired</span>
              </div>
              <strong className="stat-number">
                {String(activeCount).padStart(2, "0")}
              </strong>
              <span className="stat-description">Active warranties</span>
            </article>

            <article className="stat-card">
              <div className="stat-top">
                <span className="stat-icon amber">♧</span>
                <span className="stat-note">Worth a look</span>
              </div>
              <strong className="stat-number">
                {String(endingSoonCount).padStart(2, "0")}
              </strong>
              <span className="stat-description">Warranties ending soon</span>
            </article>
          </section>

          <section className="documents-section" id="documents">
            <div className="section-heading document-heading">
              <div>
                <h2>My Documents</h2>
                <p>Your important purchases, all in one place.</p>
              </div>
              <div className="document-heading-actions">
                {receipts.length > 0 && (
                  <button
                    type="button"
                    className="delete-all-button"
                    onClick={handleDeleteAllReceipts}
                    disabled={loading || deletingAllReceipts || deletingReceiptId !== null}
                  >
                    {deletingAllReceipts ? "Clearing documents..." : "🗑 Clear all documents"}
                  </button>
                )}
                <span className="document-count">
                  {loading ? "Loading..." : `${visibleReceipts.length} documents`}
                </span>
              </div>
            </div>
            
            <form className="ai-search-panel" onSubmit={handleAiSearch}>
              <div className="ai-search-heading">
                <span className="ai-search-icon">✳</span>
                <div>
                  <h3>Ask Receipt Raccoon</h3>
                  <p>Find a bill without remembering its exact name.</p>
                </div>
              </div>

              <div className="ai-search-controls">
                <input
                  value={aiQuery}
                  onChange={(event) => setAiQuery(event.target.value)}
                  placeholder="e.g. Find the refrigerator bill from last year"
                  maxLength={300}
                  aria-label="Ask a question about your receipts"
                />

                <button
                  type="submit"
                  className="primary-button"
                  disabled={aiSearching || loading}
                >
                  {aiSearching ? "Searching..." : "Ask AI ↗"}
                </button>
              </div>

              {aiSearching && (
                <p className="ai-search-message" role="status">
                  Gemma is looking through your receipt details...
                </p>
              )}

              {!aiSearching && aiAnswer && (
                <div className="ai-search-answer" role="status">
                  <p>{aiAnswer}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setAiMatchedIds(null);
                      setAiAnswer("");
                      setAiQuery("");
                    }}
                  >
                    Clear results
                  </button>
                </div>
              )}

              <p className="ai-search-privacy">
                Powered by your local Gemma model. Only receipt details are sent to
                your local Ollama service, not the original bill images.
              </p>
            </form>

            <label className="search-box">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search a product, shop or category..."
                aria-label="Search documents"
              />
              <kbd>SEARCH</kbd>
            </label>

            <div className="receipt-grid">
              {visibleReceipts.map((receipt) => (
                <article className="receipt-card" key={receipt.id}>
                  <div className="receipt-card-top">
                    <div className="product-icon">{receipt.icon}</div>
                    <span
                      className={`warranty-pill ${
                        receipt.status === "Ending soon"
                          ? "ending"
                          : receipt.status === "Expired"
                            ? "expired"
                            : receipt.status === "No warranty date"
                              ? "no-warranty"
                              : ""
                      }`}
                    >
                      {receipt.status === "Active"
                        ? "● Active"
                        : receipt.status === "No warranty date"
                          ? "● No warranty date"
                          : `● ${receipt.status}`}
                    </span>
                  </div>

                  <p className="receipt-category">{receipt.category}</p>
                  <h3>{receipt.name}</h3>
                  <p className="receipt-store">{receipt.store}</p>

                  <div className="receipt-divider" />

                  <div className="receipt-details">
                    <div>
                      <span>Purchase date</span>
                      <strong>{receipt.date}</strong>
                    </div>
                    <div className="price-detail">
                      <span>Bill amount</span>
                      <strong>{receipt.price}</strong>
                    </div>
                  </div>

                  <div className="warranty-detail">
                    <span>◷</span>
                    Warranty until <strong>{receipt.warranty}</strong>
                  </div>

                  {receipt.file && (
                    <button
                      type="button"
                      className="view-file-button"
                      onClick={() => openOriginal(receipt)}
                    >
                      Open original document ↗
                    </button>
                  )}

                  <button
                      type="button"
                      className="delete-receipt-button"
                      onClick={() => void handleDeleteReceipt(receipt)}
                      disabled={deletingAllReceipts || deletingReceiptId !== null}
                    >
                      {deletingReceiptId === receipt.id ? "Deleting..." : "🗑 Delete receipt"}
                    </button>
                </article>
              ))}
            </div>

            {visibleReceipts.length === 0 && (
              <div className="empty-search">
                <span>🧾</span>
                <h3>{search || aiMatchedIds !== null ? "No matching bills" : "Your document box is empty"}</h3>
                <p>
                  {search || aiMatchedIds !== null
                    ? "Try another product name, shop or category."
                    : "Add a bill to start building your personal document vault."}
                </p>
                {!search && aiMatchedIds === null && (
                  <button type="button" className="primary-button" onClick={openFilePicker}>
                    ＋ Add a bill
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="warranty-tracker" id="warranties">
            <div className="warranty-tracker-heading">
              <div>
                <p className="eyebrow">STAY IN THE KNOW</p>
                <h2>Warranty tracker</h2>
                <p>Keep an eye on every important expiry date.</p>
              </div>

              <span className="document-count">
                {warrantyReceipts.length} warranties
              </span>
            </div>

            {warrantyReceipts.length === 0 ? (
              <div className="warranty-empty">
                <span>◷</span>
                <h3>No warranty dates yet</h3>
                <p>
                  Add a warranty expiry date when saving a bill, and it will
                  appear here.
                </p>
              </div>
            ) : (
              <div className="warranty-list">
                {warrantyReceipts.map((receipt) => {
                  const days = receipt.daysRemaining!;

                  const timingText =
                    days < 0
                      ? `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago`
                      : days === 0
                        ? "Expires today"
                        : `${days} ${days === 1 ? "day" : "days"} remaining`;

                  const status: ReceiptStatus =
                    days < 0
                      ? "Expired"
                      : days <= 30
                        ? "Ending soon"
                        : "Active";

                  return (
                    <article className="warranty-row" key={receipt.id}>
                      <div className="product-icon">{receipt.icon}</div>

                      <div className="warranty-row-info">
                        <div className="warranty-row-title">
                          <h3>{receipt.name}</h3>
                          <span
                            className={`warranty-pill ${
                              status === "Expired"
                                ? "expired"
                                : status === "Ending soon"
                                  ? "ending"
                                  : ""
                            }`}
                          >
                            {status === "Active" ? "● Active" : `● ${status}`}
                          </span>
                        </div>

                        <p>
                          {receipt.store} · Warranty until {receipt.warranty}
                        </p>

                        <small className={days <= 30 ? "warranty-urgent" : ""}>
                          {timingText}
                        </small>
                      </div>

                      <div className="warranty-row-action">
                        <strong>{receipt.price}</strong>

                        {receipt.file && (
                          <button
                            type="button"
                            className="warranty-view-button"
                            onClick={() => openOriginal(receipt)}
                          >
                            View bill ↗
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <footer className="footer">
            <span>🦝 Receipt Raccoon</span>
            <span>Small effort now. Less searching later.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
