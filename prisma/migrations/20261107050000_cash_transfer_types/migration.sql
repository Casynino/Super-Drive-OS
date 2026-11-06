-- Moving money between the shop's own accounts: two new ledger types
ALTER TYPE "CashTxType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "CashTxType" ADD VALUE 'TRANSFER_IN';
