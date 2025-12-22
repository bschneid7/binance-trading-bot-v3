# Tax Reporting for US-Based Traders

This document explains the tax reporting capabilities of the Binance Trading Bot, designed to help US-based users track their crypto transactions and prepare for tax season.

**Disclaimer:** This tool is for informational purposes only and is not a substitute for professional tax advice. Always consult with a qualified tax professional for your specific situation.

## Key Features

The tax reporting module provides the following features:

| Feature                 | Description                                                                                                                                                           |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cost Basis Tracking**   | Tracks the cost basis for every crypto purchase (including fees) using tax lots.                                                                                      |
| **Accounting Methods**    | Supports multiple accounting methods: `FIFO` (First-In, First-Out), `LIFO` (Last-In, First-Out), `HIFO` (Highest-In, First-Out), and `LOFO` (Lowest-In, First-Out). `FIFO` is the default. |
| **Capital Gains**       | Automatically calculates short-term (held < 1 year) and long-term (held > 1 year) capital gains and losses for every sale.                                              |
| **Form 8949 Export**      | Generates a CSV file in the format required for IRS Form 8949, "Sales and Other Dispositions of Capital Assets".                                                        |
| **Tax Software Exports**  | Creates CSV files compatible with popular tax software like TurboTax and TaxAct, as well as generic formats for services like CoinTracker.                                |
| **Summary Reports**       | Provides a human-readable text report summarizing your trading activity, net gains/losses, and breakdowns by cryptocurrency and bot.                                      |
| **Holdings Report**       | Shows your current cryptocurrency holdings with their associated cost basis.                                                                                          |

## How to Generate Tax Reports

All tax reporting functions are handled by the `tax-report.mjs` command-line interface (CLI) tool.

### Step 1: Process Historical Trades

Before you can generate any reports, you must first process your entire trade history. This command reads all trades from the database, creates the corresponding tax lots for purchases, and records taxable events for sales.

**Run this command only once initially, and then periodically (e.g., monthly) to update with new trades.**

```bash
node tax-report.mjs --process
```

If you ever need to re-process from scratch (e.g., after changing the accounting method), you can clear the existing tax data first:

```bash
node tax-report.mjs --clear
node tax-report.mjs --process
```

### Step 2: Generate Reports

Once your trades are processed, you can generate reports for any tax year.

#### Generate All Reports

The easiest way is to generate all available report formats for a specific year:

```bash
node tax-report.mjs --year 2024 --format all
```

This will create the following files in the `data/tax-reports/` directory:

- `tax-report-2024-YYYY-MM-DD.txt`: A detailed, human-readable summary.
- `form-8949-2024-YYYY-MM-DD.csv`: For direct use with IRS Form 8949.
- `turbotax-2024-YYYY-MM-DD.csv`: For import into TurboTax.
- `taxact-2024-YYYY-MM-DD.csv`: For import into TaxAct.

#### Generate a Specific Report

You can also generate a single file:

```bash
# Generate only the TurboTax CSV
node tax-report.mjs --year 2024 --format turbotax

# Generate only the detailed text report
node tax-report.mjs --year 2024 --format report
```

### Other Useful Commands

#### View a Quick Summary

To see a quick summary of your capital gains for a year without creating a file:

```bash
node tax-report.mjs --summary 2024
```

#### View Current Holdings

To see your current crypto holdings and their cost basis:

```bash
node tax-report.mjs --holdings
```

### Changing the Accounting Method

You can specify a different accounting method using the `--method` flag. `FIFO` is the default.

```bash
# Generate a report using the Highest-In, First-Out method
node tax-report.mjs --year 2024 --method HIFO
```

**Note:** If you change the method, you should clear and re-process your trade history to ensure all calculations are correct.

## Command-Line Options

Here is a full list of available commands and options. You can also view this by running `node tax-report.mjs --help`.

| Option                 | Alias | Description                                                                                             |
| :--------------------- | :---- | :------------------------------------------------------------------------------------------------------ |
| `--year <year>`        | `-y`  | The tax year to generate a report for (defaults to the current year).                                   |
| `--format <format>`    | `-f`  | The output format: `report`, `csv`, `turbotax`, `taxact`, `cointracker`, or `all`. Defaults to `report`. |
| `--method <method>`    | `-m`  | The accounting method: `FIFO`, `LIFO`, `HIFO`, `LOFO`. Defaults to `FIFO`.                               |
| `--process`            | `-p`  | Process historical trades to build tax lots and events.                                                 |
| `--holdings`           |       | Show a summary of current crypto holdings with their cost basis.                                        |
| `--summary [year]`     | `-s`  | Display a quick capital gains summary for the specified year without creating a file.                   |
| `--clear`              |       | **DANGEROUS:** Deletes all existing tax lot and event data from the database.                             |
| `--help`               | `-h`  | Show the help message.                                                                                  |
