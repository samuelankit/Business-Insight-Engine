import { getUncachableRevenueCatClient } from "./revenueCatClient.js";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "GoRigo";

const STARTER_PRODUCT_IDENTIFIER = "gorigo_starter_monthly";
const PRO_PRODUCT_IDENTIFIER = "gorigo_pro_monthly";
const PLAY_STORE_STARTER_IDENTIFIER = "gorigo_starter_monthly:monthly";
const PLAY_STORE_PRO_IDENTIFIER = "gorigo_pro_monthly:monthly";

const STARTER_DISPLAY_NAME = "Starter Monthly";
const PRO_DISPLAY_NAME = "Pro Monthly";
const PRODUCT_DURATION = "P1M";

const APP_STORE_APP_NAME = "GoRigo iOS";
const APP_STORE_BUNDLE_ID = "com.gorigo.ios";
const PLAY_STORE_APP_NAME = "GoRigo Android";
const PLAY_STORE_PACKAGE_NAME = "com.gorigo.android";

const ENTITLEMENT_IDENTIFIER = "premium";
const ENTITLEMENT_DISPLAY_NAME = "Premium Access";

const OFFERING_IDENTIFIER = "default";
const OFFERING_DISPLAY_NAME = "Default Offering";

const STARTER_PACKAGE_IDENTIFIER = "$rc_monthly";
const STARTER_PACKAGE_DISPLAY_NAME = "Starter Monthly";
const PRO_PACKAGE_IDENTIFIER = "gorigo_pro";
const PRO_PACKAGE_DISPLAY_NAME = "Pro Monthly";

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });

  if (listProjectsError) throw new Error("Failed to list projects");

  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);

  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error: createProjectError } = await createProject({
      client,
      body: { name: PROJECT_NAME },
    });
    if (createProjectError) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listAppsError || !apps || apps.items.length === 0) {
    throw new Error("No apps found");
  }

  let testStoreApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

  if (!testStoreApp) {
    throw new Error("No app with test store found");
  } else {
    console.log("Test Store app found:", testStoreApp.id);
  }

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: APP_STORE_APP_NAME,
        type: "app_store",
        app_store: { bundle_id: APP_STORE_BUNDLE_ID },
      },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app found:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: {
        name: PLAY_STORE_APP_NAME,
        type: "play_store",
        play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
      },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app found:", playStoreApp.id);
  }

  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });

  if (listProductsError) throw new Error("Failed to list products");

  const ensureProductForApp = async (
    targetApp: App,
    label: string,
    productIdentifier: string,
    displayName: string,
    isTestStore: boolean,
  ): Promise<Product> => {
    const existingProduct = existingProducts.items?.find(
      (p) => p.store_identifier === productIdentifier && p.app_id === targetApp.id,
    );

    if (existingProduct) {
      console.log(label + " product already exists:", existingProduct.id);
      return existingProduct;
    }

    const body: CreateProductData["body"] = {
      store_identifier: productIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: displayName,
    };

    if (isTestStore) {
      body.subscription = { duration: PRODUCT_DURATION };
      body.title = displayName;
    }

    const { data: createdProduct, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });

    if (error) throw new Error("Failed to create " + label + " product");
    console.log("Created " + label + " product:", createdProduct.id);
    return createdProduct;
  };

  const testStoreStarterProduct = await ensureProductForApp(
    testStoreApp,
    "Test Store Starter",
    STARTER_PRODUCT_IDENTIFIER,
    STARTER_DISPLAY_NAME,
    true,
  );
  const appStoreStarterProduct = await ensureProductForApp(
    appStoreApp,
    "App Store Starter",
    STARTER_PRODUCT_IDENTIFIER,
    STARTER_DISPLAY_NAME,
    false,
  );
  const playStoreStarterProduct = await ensureProductForApp(
    playStoreApp,
    "Play Store Starter",
    PLAY_STORE_STARTER_IDENTIFIER,
    STARTER_DISPLAY_NAME,
    false,
  );

  const testStoreProProduct = await ensureProductForApp(
    testStoreApp,
    "Test Store Pro",
    PRO_PRODUCT_IDENTIFIER,
    PRO_DISPLAY_NAME,
    true,
  );
  const appStoreProProduct = await ensureProductForApp(
    appStoreApp,
    "App Store Pro",
    PRO_PRODUCT_IDENTIFIER,
    PRO_DISPLAY_NAME,
    false,
  );
  const playStoreProProduct = await ensureProductForApp(
    playStoreApp,
    "Play Store Pro",
    PLAY_STORE_PRO_IDENTIFIER,
    PRO_DISPLAY_NAME,
    false,
  );

  const addTestStorePrices = async (productId: string, prices: { amount_micros: number; currency: string }[]) => {
    const { data: priceData, error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: productId },
      body: { prices },
    });

    if (priceError) {
      if (
        priceError &&
        typeof priceError === "object" &&
        "type" in priceError &&
        priceError["type"] === "resource_already_exists"
      ) {
        console.log("Test store prices already exist for product:", productId);
      } else {
        throw new Error("Failed to add test store prices for product: " + productId);
      }
    } else {
      console.log("Added test store prices for product:", productId);
    }
  };

  await addTestStorePrices(testStoreStarterProduct.id, [
    { amount_micros: 19000000, currency: "GBP" },
    { amount_micros: 19990000, currency: "USD" },
  ]);

  await addTestStorePrices(testStoreProProduct.id, [
    { amount_micros: 49000000, currency: "GBP" },
    { amount_micros: 49990000, currency: "USD" },
  ]);

  let entitlement: Entitlement | undefined;
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  const existingEntitlement = existingEntitlements.items?.find(
    (e) => e.lookup_key === ENTITLEMENT_IDENTIFIER,
  );

  if (existingEntitlement) {
    console.log("Entitlement already exists:", existingEntitlement.id);
    entitlement = existingEntitlement;
  } else {
    const { data: newEntitlement, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: ENTITLEMENT_IDENTIFIER,
        display_name: ENTITLEMENT_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create entitlement");
    console.log("Created entitlement:", newEntitlement.id);
    entitlement = newEntitlement;
  }

  const { error: attachEntitlementError } = await attachProductsToEntitlement({
    client,
    path: { project_id: project.id, entitlement_id: entitlement.id },
    body: {
      product_ids: [
        testStoreStarterProduct.id,
        appStoreStarterProduct.id,
        playStoreStarterProduct.id,
        testStoreProProduct.id,
        appStoreProProduct.id,
        playStoreProProduct.id,
      ],
    },
  });

  if (attachEntitlementError) {
    if (attachEntitlementError.type === "unprocessable_entity_error") {
      console.log("Products already attached to entitlement");
    } else {
      throw new Error("Failed to attach products to entitlement");
    }
  } else {
    console.log("Attached products to entitlement");
  }

  let offering: Offering | undefined;
  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });

  if (listOfferingsError) throw new Error("Failed to list offerings");

  const existingOffering = existingOfferings.items?.find((o) => o.lookup_key === OFFERING_IDENTIFIER);

  if (existingOffering) {
    console.log("Offering already exists:", existingOffering.id);
    offering = existingOffering;
  } else {
    const { data: newOffering, error } = await createOffering({
      client,
      path: { project_id: project.id },
      body: {
        lookup_key: OFFERING_IDENTIFIER,
        display_name: OFFERING_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create offering");
    console.log("Created offering:", newOffering.id);
    offering = newOffering;
  }

  if (!offering.is_current) {
    const { error } = await updateOffering({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: { is_current: true },
    });
    if (error) throw new Error("Failed to set offering as current");
    console.log("Set offering as current");
  }

  const { data: existingPackages, error: listPackagesError } = await listPackages({
    client,
    path: { project_id: project.id, offering_id: offering.id },
    query: { limit: 20 },
  });

  if (listPackagesError) throw new Error("Failed to list packages");

  let starterPkg: Package | undefined;
  const existingStarterPackage = existingPackages.items?.find(
    (p) => p.lookup_key === STARTER_PACKAGE_IDENTIFIER,
  );

  if (existingStarterPackage) {
    console.log("Starter package already exists:", existingStarterPackage.id);
    starterPkg = existingStarterPackage;
  } else {
    const { data: newPackage, error } = await createPackages({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: {
        lookup_key: STARTER_PACKAGE_IDENTIFIER,
        display_name: STARTER_PACKAGE_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create starter package");
    console.log("Created starter package:", newPackage.id);
    starterPkg = newPackage;
  }

  let proPkg: Package | undefined;
  const existingProPackage = existingPackages.items?.find(
    (p) => p.lookup_key === PRO_PACKAGE_IDENTIFIER,
  );

  if (existingProPackage) {
    console.log("Pro package already exists:", existingProPackage.id);
    proPkg = existingProPackage;
  } else {
    const { data: newPackage, error } = await createPackages({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      body: {
        lookup_key: PRO_PACKAGE_IDENTIFIER,
        display_name: PRO_PACKAGE_DISPLAY_NAME,
      },
    });
    if (error) throw new Error("Failed to create pro package");
    console.log("Created pro package:", newPackage.id);
    proPkg = newPackage;
  }

  const attachPkg = async (pkgId: string, products: { product_id: string; eligibility_criteria: string }[]) => {
    const { error } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkgId },
      body: { products },
    });
    if (error) {
      if (error.type === "unprocessable_entity_error" && error.message?.includes("Cannot attach product")) {
        console.log("Skipping package attach: already has incompatible product");
      } else {
        throw new Error("Failed to attach products to package: " + JSON.stringify(error));
      }
    } else {
      console.log("Attached products to package:", pkgId);
    }
  };

  await attachPkg(starterPkg.id, [
    { product_id: testStoreStarterProduct.id, eligibility_criteria: "all" },
    { product_id: appStoreStarterProduct.id, eligibility_criteria: "all" },
    { product_id: playStoreStarterProduct.id, eligibility_criteria: "all" },
  ]);

  await attachPkg(proPkg.id, [
    { product_id: testStoreProProduct.id, eligibility_criteria: "all" },
    { product_id: appStoreProProduct.id, eligibility_criteria: "all" },
    { product_id: playStoreProProduct.id, eligibility_criteria: "all" },
  ]);

  const { data: testStoreApiKeys, error: testStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: testStoreApp.id },
  });
  if (testStoreApiKeysError) throw new Error("Failed to list public API keys for Test Store app");

  const { data: appStoreApiKeys, error: appStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: appStoreApp.id },
  });
  if (appStoreApiKeysError) throw new Error("Failed to list public API keys for App Store app");

  const { data: playStoreApiKeys, error: playStoreApiKeysError } = await listAppPublicApiKeys({
    client,
    path: { project_id: project.id, app_id: playStoreApp.id },
  });
  if (playStoreApiKeysError) throw new Error("Failed to list public API keys for Play Store app");

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testStoreApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("REVENUECAT_PROJECT_ID=" + project.id);
  console.log("REVENUECAT_TEST_STORE_APP_ID=" + testStoreApp.id);
  console.log("REVENUECAT_APPLE_APP_STORE_APP_ID=" + appStoreApp.id);
  console.log("REVENUECAT_GOOGLE_PLAY_STORE_APP_ID=" + playStoreApp.id);
  console.log(
    "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=" +
      (testStoreApiKeys?.items.map((item) => item.key).join(", ") ?? "N/A"),
  );
  console.log(
    "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=" +
      (appStoreApiKeys?.items.map((item) => item.key).join(", ") ?? "N/A"),
  );
  console.log(
    "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=" +
      (playStoreApiKeys?.items.map((item) => item.key).join(", ") ?? "N/A"),
  );
  console.log("====================\n");
}

seedRevenueCat().catch(console.error);
