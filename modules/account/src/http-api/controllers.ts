import { Transient } from "@abp/core";
import { AbpControllerBase, Controller, HttpGet, HttpPost, HttpPut, body } from "@abp/aws-lambda";
import type { IdentityUserDto } from "@abp/identity/application-contracts";
import {
  AccountRemoteServiceConsts,
  ChangePasswordInput,
  IAccountAppService,
  IDynamicClaimsAppService,
  IProfileAppService,
  RegisterDto,
  ResetPasswordDto,
  SendPasswordResetCodeDto,
  UpdateProfileDto,
  VerifyPasswordResetTokenInput,
  type ProfileDto,
} from "../application-contracts/index.js";

const controllerOptions = { remoteServiceName: AccountRemoteServiceConsts.RemoteServiceName, area: AccountRemoteServiceConsts.ModuleName };

/** Port of `AccountController` (`api/account`). */
@Transient()
@Controller("api/account", controllerOptions)
export class AccountController extends AbpControllerBase {
  static readonly inject = [IAccountAppService] as const;

  constructor(protected readonly accountAppService: IAccountAppService) {
    super();
  }

  @HttpPost("register", body(RegisterDto))
  register(input: RegisterDto): Promise<IdentityUserDto> {
    return this.accountAppService.register(input);
  }

  @HttpPost("send-password-reset-code", body(SendPasswordResetCodeDto))
  sendPasswordResetCode(input: SendPasswordResetCodeDto): Promise<void> {
    return this.accountAppService.sendPasswordResetCode(input);
  }

  @HttpPost("verify-password-reset-token", body(VerifyPasswordResetTokenInput))
  verifyPasswordResetToken(input: VerifyPasswordResetTokenInput): Promise<boolean> {
    return this.accountAppService.verifyPasswordResetToken(input);
  }

  @HttpPost("reset-password", body(ResetPasswordDto))
  resetPassword(input: ResetPasswordDto): Promise<void> {
    return this.accountAppService.resetPassword(input);
  }
}

/** Port of `ProfileController` (`api/account/my-profile`). */
@Transient()
@Controller("api/account/my-profile", controllerOptions)
export class ProfileController extends AbpControllerBase {
  static readonly inject = [IProfileAppService] as const;

  constructor(protected readonly profileAppService: IProfileAppService) {
    super();
  }

  @HttpGet("")
  get(): Promise<ProfileDto> {
    return this.profileAppService.get();
  }

  @HttpPut("", body(UpdateProfileDto))
  update(input: UpdateProfileDto): Promise<ProfileDto> {
    return this.profileAppService.update(input);
  }

  @HttpPost("change-password", body(ChangePasswordInput))
  changePassword(input: ChangePasswordInput): Promise<void> {
    return this.profileAppService.changePassword(input);
  }
}

/** Port of `DynamicClaimsController` (`api/account/dynamic-claims`). */
@Transient()
@Controller("api/account/dynamic-claims", controllerOptions)
export class DynamicClaimsController extends AbpControllerBase {
  static readonly inject = [IDynamicClaimsAppService] as const;

  constructor(protected readonly dynamicClaimsAppService: IDynamicClaimsAppService) {
    super();
  }

  @HttpPost("refresh")
  refresh(): Promise<void> {
    return this.dynamicClaimsAppService.refresh();
  }
}
