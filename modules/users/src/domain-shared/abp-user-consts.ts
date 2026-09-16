/** Port of `AbpUserConsts` (mutable statics like ABP so applications can change the limits). */
export class AbpUserConsts {
  /** Default value: 256 */
  static maxUserNameLength = 256;
  /** Default value: 64 */
  static maxNameLength = 64;
  /** Default value: 64 */
  static maxSurnameLength = 64;
  /** Default value: 256 */
  static maxEmailLength = 256;
  /** Default value: 16 */
  static maxPhoneNumberLength = 16;
}
