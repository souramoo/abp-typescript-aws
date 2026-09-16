/** Port of `BackgroundJobRecordConsts` (mutable statics, like the .NET properties). */
export class BackgroundJobRecordConsts {
  /** Default value: 96 */
  static maxApplicationNameLength = 96;
  /** Default value: 128 */
  static maxJobNameLength = 128;
  /** Default value: 1024 * 1024 */
  static maxJobArgsLength = 1024 * 1024;
}
