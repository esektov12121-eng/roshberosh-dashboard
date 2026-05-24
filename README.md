# 🎮 RoshBeRosh Live Dashboard & Control Center

Welcome to the ultimate, enterprise-grade, mobile-responsive Web Control Center for RoshBeRosh! 

This project transforms your static CLI script into a highly interactive, responsive web application specifically optimized for mobile Safari (iOS) and desktop browsers. Since you are away from home, this dashboard allows you to configure settings, monitor live diagnostics, manually override turns, and claim daily rewards remotely from your iPhone or iPad.

---

## 🏗️ Architectural Overview

This system is built with a decoupled, event-driven architecture using **Node.js**, **Express**, and **Socket.IO** for real-time bi-directional messaging:

1. **`bot-runner.js` (Core Engine)**:
   - Contains the stateful `RoshBeRoshBot` class extending `EventEmitter`.
   - Encapsulates the entire game state (multiplayer sockets, matchmaking tickets, countdown timers, used answers, and opponent profile metrics).
   - Coordinates the connection pipeline, including pre-flight health checks, daily rewards claim, automatic re-queue, and anti-desertion shielding.
   - Leverages a **dual-path solver** utilizing low-latency Google Gemini API (with strict deadline timers) and a fast local-fallback keyword dictionary.

2. **`server.js` (API & Streaming Controller)**:
   - Hosts the HTTP REST endpoints and the real-time Socket.IO portal.
   - Manages a persistent in-memory logs history buffer, allowing you to view historical console actions even after refreshing your browser.
   - Reads and writes to `config.json` automatically, retaining your Device ID, API keys, and custom word overrides across restarts.

3. **`public/index.html` & `public/app.js` (Tailwind Web UI)**:
   - Features a gorgeous, high-contrast dark-mode terminal layout.
   - Incorporates **iOS Mobile-First Tabs**:
     - 📱 **Game Board**: Monitors real-time category strings, opponent status, and displays a giant manual answer input for quick tactile overrides.
     - 📟 **Terminal Logs**: Renders colored logs by source systems (`[AI]`, `[SOCKET]`, `[MATCH]`) with real-time text-search and level filtering.
     - ⚙️ **Settings**: Lets you adjust server keys, swap Device IDs, test your Gemini API key, trigger manual RPC claims, and construct custom regex-word override lists.

---

## 🚀 Step-by-Step Deployment Guide

Since you are away for two weeks and using your iPhone, you can host this project on several platforms. Here are the best ways to get it running:

### Option A: Hosting on Replit (Easiest for Mobile Editing)
Replit is a free and extremely powerful container platform with a web-based code editor that works amazingly well on iOS Safari.
1. Sign in to your free [Replit](https://replit.com) account.
2. Click **Create Repl**, choose the **Node.js** template, and name it `roshberosh-dashboard`.
3. In Replit's file explorer, paste the contents of:
   - `package.json`
   - `config.json`
   - `bot-runner.js`
   - `server.js`
   - Create a folder named `public` and add `index.html` and `app.js` inside it.
4. Go to **Tools > Secrets** (or Environment Variables) on the left sidebar and add:
   - `GEMINI_API_KEY`: *Your Google AI developer key* (or keep it in the dashboard UI).
5. Click the green **Run** button. Replit will install the dependencies and open a browser window displaying your Live Dashboard! Copy the public URL (usually ending in `.repl.co` or `.replit.app`) and bookmark it on your iPhone.

### Option B: Hosting on Render (Free & Fully Managed)
Render is a fantastic, free cloud provider that deploys straight from a GitHub repository.
1. Push these project files to a private or public GitHub repository.
2. Log in to [Render](https://render.com) and click **New > Web Service**.
3. Link your GitHub repository.
4. Set the following details:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Advanced** and add the environment variable:
   - `GEMINI_API_KEY`: *Your Google AI developer key*
6. Deploy! Render will build your dashboard and generate a secure HTTPS link you can access on iOS.

---

## 📱 How to Play & Control on iOS Safari

The dashboard has been engineered specifically for optimal touch-screen controls:

1. **Dashboard Overview**:
   - The **Live Status Badge** at the top pulses green when you are in a match (`PLAYING`), blue when connected (`IDLE`), indigo when `SEARCHING`, and yellow when executing `PREFLIGHT` checks.
   - Swipe or tap the bottom navigation tabs (**Game Board**, **Terminal Logs**, **Settings**) to swap screens instantly.

2. **Claiming Free Coins/Energy**:
   - Switch to **Settings**, look under **Diagnostics Controls**, and click **Execute Daily Reward Claim RPCs**. The bot will automatically query Nakama's reward claim APIs and update your wallet coins and energy indicators instantly.

3. **Manual Answer Override**:
   - If the AI is struggling, or you want to show off your skills, type an answer into the **Hebrew Input Field** under the Game Board.
   - Tap the **Up Arrow (Submit)**. This overrides the automated AI timer and posts the answer directly to Nakama.

4. **Rule-Based Custom Matches**:
   - Under **Settings**, you can write custom regular expressions. For instance, if you add the match regex `פירות|ירקות` with the Hebrew answer `תפוח`, the bot will bypass Gemini and instantly submit `תפוח` every time a fruit or vegetable category is seen. This gives you a guaranteed fast-path win for known categories.

---

## 🛠️ File Layout Reference

The following files make up this application:
- `bot-runner.js` — Core game client managing WebSocket streams, auth credentials, and AI logic.
- `server.js` — The dashboard backend serving public files and Socket.IO API events.
- `config.json` — Persistent database storage file for all user parameters.
- `package.json` — Node project package definitions and commands.
- `public/index.html` — The main structural view with Tailwind UI and layout tabs.
- `public/app.js` — Web client handling live DOM rendering, user interactions, and sockets.
