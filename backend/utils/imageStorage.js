import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const UPLOAD_ROOT = path.resolve(__dirname, "..", "uploads");
export const WORKSPACE_UPLOADS_DIR = path.join(UPLOAD_ROOT, "workspaces");
export const TEMP_UPLOADS_DIR = path.join(WORKSPACE_UPLOADS_DIR, "temp");

// Ensure upload directories exist
export const ensureUploadDirs = () => {
  try {
    if (!fs.existsSync(WORKSPACE_UPLOADS_DIR)) {
      fs.mkdirSync(WORKSPACE_UPLOADS_DIR, { recursive: true });
    }
    if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
      fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
    }
  } catch (err) {
    // In serverless / read-only environments (like Vercel), local disk writes outside /tmp fail.
    // We catch this gracefully so the server boots cleanly without crashing.
    console.warn("Upload directories check skipped (read-only filesystem):", err.message);
  }
};

// Initial directory verification on startup
ensureUploadDirs();

/**
 * Process and optimize uploaded image files using Sharp
 * - Validates actual image binary content
 * - Supports memory storage buffers (serverless/Vercel) and disk paths (local dev)
 * - Resizes large images (max 1600x1200, aspect-ratio preserved)
 * - Converts to optimized WebP format
 * - Saves to local uploads directory if disk is writable, or generates a
 *   persistent WebP Data URI on read-only serverless environments (Vercel)
 * - Returns metadata array
 */
export const processAndOptimizeImages = async (files = [], req) => {
  ensureUploadDirs();
  const processedImages = [];
  const newlyCreatedFiles = [];

  try {
    for (const file of files) {
      // 1. Get raw image buffer from multer memoryStorage or disk file
      let imageBuffer = file.buffer;
      if (!imageBuffer && file.path && fs.existsSync(file.path)) {
        try {
          imageBuffer = fs.readFileSync(file.path);
        } catch (readErr) {
          console.warn("Could not read temp file:", file.path, readErr.message);
        }
      }

      if (!imageBuffer) {
        continue;
      }

      // 2. Validate actual image content with Sharp
      let metadata;
      try {
        metadata = await sharp(imageBuffer).metadata();
      } catch (sharpErr) {
        throw new Error(
          `File "${file.originalname}" is corrupted or is not a valid image.`
        );
      }

      const validFormats = ["jpeg", "jpg", "png", "webp"];
      if (!metadata || !validFormats.includes(metadata.format?.toLowerCase())) {
        throw new Error(
          `File "${file.originalname}" has an unsupported image format. Only JPEG, PNG, and WebP are allowed.`
        );
      }

      // 3. Generate unique filename
      const uniqueId = crypto.randomUUID();
      const filename = `${uniqueId}.webp`;

      // 4. Resize and optimize image to WebP buffer
      const optimizedBuffer = await sharp(imageBuffer)
        .rotate() // Automatically orient based on EXIF
        .resize({
          width: 1600,
          height: 1200,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();

      // 5. Try writing to disk (local dev). If filesystem is read-only (Vercel),
      // fallback to persistent base64 Data URI so publishing never fails!
      let url = "";
      try {
        ensureUploadDirs();
        const targetPath = path.join(WORKSPACE_UPLOADS_DIR, filename);
        fs.writeFileSync(targetPath, optimizedBuffer);
        newlyCreatedFiles.push(targetPath);
        url = `/uploads/workspaces/${filename}`;
      } catch (diskErr) {
        // Serverless read-only filesystem (e.g. Vercel)
        url = `data:image/webp;base64,${optimizedBuffer.toString("base64")}`;
      }

      // 6. Clean up temporary uploaded file if one was on disk
      if (file.path) {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupErr) {
          console.warn("Failed to delete temp file:", file.path, cleanupErr.message);
        }
      }

      processedImages.push({
        url,
        filename,
        originalName: path.basename(file.originalname).substring(0, 100),
        size: optimizedBuffer.length,
        format: "webp",
        alt: "Workspace photo",
      });
    }

    return processedImages;
  } catch (error) {
    // If any image fails, clean up all newly created files in this batch to prevent orphans
    for (const createdPath of newlyCreatedFiles) {
      try {
        if (fs.existsSync(createdPath)) {
          fs.unlinkSync(createdPath);
        }
      } catch (e) {
        console.error("Cleanup error for created file:", createdPath, e.message);
      }
    }

    // Also clean up any remaining temp files from this request
    for (const file of files) {
      if (file.path) {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (e) {
          // ignore
        }
      }
    }

    throw error;
  }
};

/**
 * Delete image files from the local uploads directory
 * Strictly validates path to prevent path traversal attacks
 */
export const deleteWorkspaceImageFiles = (imageEntries = []) => {
  ensureUploadDirs();

  for (const entry of imageEntries) {
    try {
      let filename = "";

      if (typeof entry === "string") {
        // Could be a URL or filename
        filename = path.basename(entry);
      } else if (entry && typeof entry === "object") {
        filename = entry.filename || (entry.url ? path.basename(entry.url) : "");
      }

      if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        continue;
      }

      // Resolve absolute file path and verify it stays inside WORKSPACE_UPLOADS_DIR
      const targetPath = path.resolve(WORKSPACE_UPLOADS_DIR, filename);

      if (!targetPath.startsWith(WORKSPACE_UPLOADS_DIR)) {
        console.warn("Path traversal blocked for file:", filename);
        continue;
      }

      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        console.log(`Deleted workspace image file: ${filename}`);
      }
    } catch (err) {
      console.warn("Error deleting workspace image file:", err.message);
    }
  }
};

