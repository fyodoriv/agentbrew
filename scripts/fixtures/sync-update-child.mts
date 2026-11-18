enum LoaderReceipt {
  Ready = "fixture-loader-ready",
}

if (process.argv[2] === "loader-control") {
  process.stdout.write(LoaderReceipt.Ready);
} else {
  const { update } = await import("../../src/update.js");
  await update({ only: "" });
}
