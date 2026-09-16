import { AbpApplication, AbpModule, DependsOn, SimpleStateCheckerContext, Transient, hasErrorCode, type IHasSimpleStateCheckers, type ISimpleStateChecker } from "@abp/core";
import { AbpAuthorizationException } from "@abp/authorization";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AbpGlobalFeatureErrorCodes,
  AbpGlobalFeatureNotEnabledException,
  AbpGlobalFeaturesModule,
  GlobalFeature,
  GlobalFeatureCheckingEnabled,
  GlobalFeatureManager,
  GlobalFeatureName,
  GlobalModuleFeatures,
  RequiresGlobalFeature,
  getGlobalFeatureName,
  getRequiredGlobalFeatureName,
  isGlobalFeatureEnabled,
  requireGlobalFeatures,
} from "../src/index.js";

@GlobalFeatureName("Cms.Comments")
class CommentsFeature extends GlobalFeature {}

@GlobalFeatureName("Cms.Ratings")
class RatingsFeature extends GlobalFeature {}

class UnnamedFeature extends GlobalFeature {}

class CmsFeatures extends GlobalModuleFeatures {
  static readonly moduleName = "Cms";
  readonly comments: CommentsFeature;
  readonly ratings: RatingsFeature;
  constructor(featureManager: GlobalFeatureManager) {
    super(featureManager);
    this.comments = new CommentsFeature(this);
    this.ratings = new RatingsFeature(this);
    this.addFeature(this.comments);
    this.addFeature(this.ratings);
  }
}

@Transient()
@GlobalFeatureCheckingEnabled()
@RequiresGlobalFeature(CommentsFeature)
class CommentAppService {
  async list(): Promise<string> {
    return "comments";
  }
}

@Transient()
@GlobalFeatureCheckingEnabled()
@RequiresGlobalFeature("Cms.Ratings")
class RatingAppService {
  async list(): Promise<string> {
    return "ratings";
  }
}

@Transient()
@RequiresGlobalFeature("Cms.Ratings")
class UncheckedAppService {
  async list(): Promise<string> {
    return "unchecked";
  }
}

@Transient()
@GlobalFeatureCheckingEnabled()
class FreeAppService {
  async list(): Promise<string> {
    return "free";
  }
}

@DependsOn(AbpGlobalFeaturesModule)
class TestModule extends AbpModule {}

class State implements IHasSimpleStateCheckers<State> {
  readonly stateCheckers: ISimpleStateChecker<State>[] = [];
}

beforeEach(() => {
  GlobalFeatureManager.instance = new GlobalFeatureManager();
});

describe("GlobalFeatureManager", () => {
  it("enables and disables features by name, class or module features", () => {
    const manager = GlobalFeatureManager.instance;
    expect(manager.isEnabled(CommentsFeature)).toBe(false);
    manager.enable("Cms.Comments");
    expect(manager.isEnabled(CommentsFeature)).toBe(true);
    manager.disable(CommentsFeature);
    expect(manager.isEnabled("Cms.Comments")).toBe(false);

    manager.modules.configure(CmsFeatures, (cms) => cms.enableAll());
    expect(manager.getEnabledFeatureNames()).toEqual(["Cms.Comments", "Cms.Ratings"]);
    const cms = manager.modules.getOrAddType(CmsFeatures);
    expect(manager.modules.get("Cms")).toBe(cms);
    cms.disable(RatingsFeature);
    expect(cms.ratings.isEnabled).toBe(false);
    cms.ratings.isEnabled = true;
    expect(manager.isEnabled(RatingsFeature)).toBe(true);
    cms.setEnabled("Cms.Comments", false);
    expect(cms.getFeature(CommentsFeature).isEnabled).toBe(false);
    cms.disableAll();
    expect(manager.getEnabledFeatureNames()).toEqual([]);
    expect(cms.getFeatures().map((f) => f.featureName)).toEqual(["Cms.Comments", "Cms.Ratings"]);
    expect(() => cms.getFeature("Nope")).toThrow("There is no feature defined by name 'Nope'.");
    expect(getGlobalFeatureName(CommentsFeature)).toBe("Cms.Comments");
    expect(() => getGlobalFeatureName(UnnamedFeature)).toThrow(/should define the GlobalFeatureName attribute/);
    expect(() => new UnnamedFeature(cms)).toThrow(/GlobalFeatureName/);
  });

  it("evaluates RequiresGlobalFeature metadata and the simple state checker", async () => {
    expect(getRequiredGlobalFeatureName(CommentAppService)).toBe("Cms.Comments");
    expect(getRequiredGlobalFeatureName(FreeAppService)).toBeUndefined();
    expect(isGlobalFeatureEnabled(CommentAppService)).toEqual({ enabled: false, featureName: "Cms.Comments" });
    expect(isGlobalFeatureEnabled(FreeAppService)).toEqual({ enabled: true, featureName: undefined });

    const state = requireGlobalFeatures(new State(), [CommentsFeature, "Cms.Ratings"]);
    const anyState = requireGlobalFeatures(new State(), ["Cms.Comments", "Cms.Ratings"], false);
    const check = (s: State) => s.stateCheckers[0]!.isEnabled(new SimpleStateCheckerContext(undefined as never, s));
    expect(await check(state)).toBe(false);
    GlobalFeatureManager.instance.enable(CommentsFeature);
    expect(await check(state)).toBe(false);
    expect(await check(anyState)).toBe(true);
    GlobalFeatureManager.instance.enable(RatingsFeature);
    expect(await check(state)).toBe(true);
  });
});

describe("GlobalFeatureInterceptor", () => {
  it("blocks services whose required global feature is disabled", async () => {
    const app = await AbpApplication.create(TestModule, { configuration: { skipDefaults: true } });
    await app.initialize();
    const comments = app.serviceProvider.getRequired(CommentAppService);
    const ratings = app.serviceProvider.getRequired(RatingAppService);

    const error = await comments.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbpGlobalFeatureNotEnabledException);
    expect(error).toBeInstanceOf(AbpAuthorizationException);
    expect(hasErrorCode(error) && error.code).toBe(AbpGlobalFeatureErrorCodes.GlobalFeatureIsNotEnabled);
    expect((error as AbpGlobalFeatureNotEnabledException).message).toBe("The 'CommentAppService' service needs to enable 'Cms.Comments' feature.");
    expect((error as AbpGlobalFeatureNotEnabledException).data).toEqual({ ServiceName: "CommentAppService", GlobalFeatureName: "Cms.Comments" });
    await expect(ratings.list()).rejects.toBeInstanceOf(AbpGlobalFeatureNotEnabledException);
    expect(await app.serviceProvider.getRequired(UncheckedAppService).list()).toBe("unchecked");
    expect(await app.serviceProvider.getRequired(FreeAppService).list()).toBe("free");

    GlobalFeatureManager.instance.modules.configure(CmsFeatures, (cms) => cms.enable(CommentsFeature));
    expect(await comments.list()).toBe("comments");
    await expect(ratings.list()).rejects.toBeInstanceOf(AbpGlobalFeatureNotEnabledException);
    GlobalFeatureManager.instance.enable("Cms.Ratings");
    expect(await ratings.list()).toBe("ratings");
    await app.shutdown();
  });
});
