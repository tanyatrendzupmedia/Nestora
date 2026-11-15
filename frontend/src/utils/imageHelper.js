const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

/**
 * Normalizes and formats an image URL for display in the frontend.
 * - Handles string URLs and image objects ({ url: ... })
 * - Handles full external URLs (http/https/data/blob)
 * - Sanitizes self-hosted backend uploads (/uploads/workspaces/...)
 * - Automatically strips any hardcoded localhost or backend host so it resolves
 *   correctly on both local development and deployed Vercel production.
 */
export const getImageUrl = (
  image,
  fallback = "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80"
) => {
  if (!image) return fallback;

  let url = typeof image === "string" ? image : image?.url;
  if (!url || typeof url !== "string") return fallback;

  // 1. Data URIs or Blob URLs
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }

  // 2. Self-hosted backend uploads (/uploads/...)
  // Even if saved in DB as "http://localhost:5000/uploads/workspaces/xyz.webp",
  // normalize to the correct domain!
  if (url.includes("/uploads/")) {
    const uploadPath = url.substring(url.indexOf("/uploads/"));

    // If running in local browser on localhost (e.g. Vite dev on :5173 talking to backend on :5000)
    if (typeof window !== "undefined" && window.location.hostname === "localhost") {
      const backendOrigin =
        API_BASE_URL && API_BASE_URL.startsWith("http")
          ? API_BASE_URL.replace(/\/$/, "")
          : "http://localhost:5000";
      return `${backendOrigin}${uploadPath}`;
    }

    // In production on Vercel (same-origin monorepo), return relative path
    return uploadPath;
  }

  // 3. External HTTP / HTTPS URLs (e.g. Unsplash)
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `${url.startsWith("/") ? "" : "/"}${url}`;
};

