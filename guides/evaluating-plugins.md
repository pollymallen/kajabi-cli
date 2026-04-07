# How to evaluate a third-party Claude plugin before you install it

Installing a plugin gives it access to Claude's tools — which can include your file system, your terminal, and any services it connects to. Most plugins are fine. But "most" isn't "all," and you're a business owner with real financial data. A few minutes of due diligence is worth it.

The good news: if a plugin is open source, you can ask Claude to read the code and explain exactly what it does. You don't need to know how to code. You just need to know what to ask.

---

## Step 1: Ask Claude to read the code

Open a Claude session (no plugin installed yet) and paste this:

> I'm thinking about installing a Claude plugin. The source code is at [GitHub URL]. Please read through it and tell me:
> 1. What external servers or services does this plugin connect to?
> 2. Does it store any of my credentials, passwords, or session data — and if so, where?
> 3. Does it read or write files on my computer — and if so, which ones?
> 4. Is there anything in this code that seems inconsistent with what the plugin claims to do?

A trustworthy plugin will have clean answers to all four. It connects to exactly the services it says it does, stores only what it needs to function, and nothing in the code contradicts the description.

**Red flags to watch for in Claude's response:**
- Connects to servers not mentioned in the README
- Sends data to an analytics service, a logging endpoint, or any URL that isn't the service the plugin is for
- Stores passwords or credentials in a file (session tokens are normal; passwords are not)
- Code that's obfuscated or hard to explain — if Claude says "I can't tell what this section does," that's worth investigating

---

## Step 2: Check what the plugin actually touches

Ask Claude to get specific:

> Look at the commands and scripts in this plugin. For each one, tell me: what does it do when it runs on my computer, and what data does it send anywhere?

This is where you'd catch something like a plugin that claims to "check your revenue" but also quietly reads your contacts file, or one that sends your data somewhere other than the service it's connected to.

---

## Step 3: Sanity-check the open source repo itself

A healthy open-source project has a few things you can spot without reading any code:

- **Recent commits.** If the last update was two years ago, it may not be maintained. Check the commit history on GitHub.
- **An open README.** A plugin with no documentation is asking you to trust it blindly.
- **The author is findable.** A real name, a real GitHub profile, a real website. Anonymous plugins aren't automatically bad, but they're harder to hold accountable.
- **Issues and responses.** If people have reported problems, are they being addressed?

---

## Step 4: Match what it asks for against what it needs

When you install a plugin, pay attention to what it does during setup. Ask yourself: does this match what it said it would do?

For a plugin that pulls data from a web service, you'd expect it to ask you to log in to that service. You would not expect it to ask for unrelated permissions — access to your email, your calendar, or services it never mentioned.

If setup asks for something that doesn't match the description, ask Claude:

> This plugin asked me for [X] during setup. Based on the source code, why would it need that? Is this expected?

---

## The short version

You don't need to read code to evaluate a plugin. You need to ask the right questions and pay attention to the answers. Claude can read the code for you — your job is to notice when something doesn't add up.

If a plugin is well-built, these questions will have boring answers. That's what you want.
