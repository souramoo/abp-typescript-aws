import { BackgroundJobInfo } from "@abp/background-jobs";
import { MappingProfile } from "@abp/object-mapping";
import { BackgroundJobRecord } from "./background-job-record.js";

function copyInfoToRecord(source: BackgroundJobInfo, record: BackgroundJobRecord): void {
  record.applicationName = source.applicationName;
  record.jobName = source.jobName;
  record.jobArgs = source.jobArgs;
  record.tryCount = source.tryCount;
  record.creationTime = source.creationTime;
  record.nextTryTime = source.nextTryTime;
  record.lastTryTime = source.lastTryTime;
  record.isAbandoned = source.isAbandoned;
  record.completionTime = source.completionTime;
  record.priority = source.priority;
}

function copyRecordToInfo(source: BackgroundJobRecord, info: BackgroundJobInfo): void {
  info.id = source.id;
  info.applicationName = source.applicationName;
  info.jobName = source.jobName;
  info.jobArgs = source.jobArgs;
  info.tryCount = source.tryCount;
  info.creationTime = source.creationTime;
  info.nextTryTime = source.nextTryTime;
  info.lastTryTime = source.lastTryTime;
  info.isAbandoned = source.isAbandoned;
  info.completionTime = source.completionTime;
  info.priority = source.priority;
}

/** Port of `BackgroundJobsDomainMapperlyMappers` (`ConcurrencyStamp`/`ExtraProperties` of the record are left alone). */
export class BackgroundJobsDomainMappingProfile extends MappingProfile {
  constructor() {
    super();
    this.createMap(
      BackgroundJobInfo,
      BackgroundJobRecord,
      (source) => {
        const record = new BackgroundJobRecord(source.id);
        copyInfoToRecord(source, record);
        return record;
      },
      (source, record) => copyInfoToRecord(source, record),
    );
    this.createMap(
      BackgroundJobRecord,
      BackgroundJobInfo,
      (source) => {
        const info = new BackgroundJobInfo();
        copyRecordToInfo(source, info);
        return info;
      },
      (source, info) => copyRecordToInfo(source, info),
    );
  }
}
