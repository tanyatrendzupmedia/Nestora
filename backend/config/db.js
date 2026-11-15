import mongoose from "mongoose";

let isConnected = false;

const connectDB = async () => {
  // If already connected, reuse existing MongoDB connection
  if (mongoose.connections?.[0]?.readyState >= 1 || isConnected) {
    return mongoose.connection;
  }

  if (!process.env.MONGO_URI) {
    const errorMsg = "CRITICAL: MONGO_URI environment variable is not set!";
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const connection = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;

    console.log(
      `MongoDB Connected: ${connection.connection.host}`
    );
    return connection;
  } catch (error) {
    console.error("MongoDB Connection Failed:", error.message);
    throw error;
  }
};

export default connectDB;