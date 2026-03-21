import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { usersTable } from "./users";

export const contactsTable = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    tags: jsonb("tags").$type<string[]>().default([]),
    consentGiven: boolean("consent_given").notNull().default(false),
    consentAt: timestamp("consent_at"),
    dncListed: boolean("dnc_listed").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contacts_business_idx").on(t.businessId),
    index("contacts_phone_idx").on(t.phone),
  ],
);

export type Contact = typeof contactsTable.$inferSelect;

export const contactListsTable = pgTable(
  "contact_lists",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    contactCount: text("contact_count").notNull().default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("contact_lists_business_idx").on(t.businessId)],
);

export type ContactList = typeof contactListsTable.$inferSelect;

export const contactListMembersTable = pgTable(
  "contact_list_members",
  {
    listId: text("list_id")
      .notNull()
      .references(() => contactListsTable.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contactsTable.id, { onDelete: "cascade" }),
  },
  (t) => [index("contact_list_members_list_idx").on(t.listId)],
);
