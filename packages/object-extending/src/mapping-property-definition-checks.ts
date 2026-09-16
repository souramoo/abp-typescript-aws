/** Port of the `[Flags] MappingPropertyDefinitionChecks` enum. */
export enum MappingPropertyDefinitionChecks {
  /** Same as `undefined`: use the default per-property logic. */
  Null = 0,
  /** No check. Copy all extra properties from the source to the destination. */
  None = 1 << 0,
  /** Copy the extra properties defined for the source class. */
  Source = 1 << 1,
  /** Copy the extra properties defined for the destination class. */
  Destination = 1 << 2,
  /** Copy extra properties defined for both of the source and destination classes. */
  Both = Source | Destination,
}
