/*
 * Auto Number plug-in
 * Copyright (c) 2016 Cybozu
 *
 * Licensed under the MIT License
 */

((PLUGIN_ID, $) => {
  'use strict';

  const kintonePluginAutonum = {
    lang: {
      ja: {
        alertMessage: {
          failedAutoNumbering: '自動採番の番号取得に失敗しました\n',
          apiTokenInvalid: 'APIトークンに正しい権限が設定されていません'

        }
      },
      en: {
        alertMessage: {
          failedAutoNumbering: 'Failed to retrieve number for Autonumbering\n',
          apiTokenInvalid: 'The API token does not have the correct permission'
        }
      },
      zh: {
        alertMessage: {
          failedAutoNumbering: '自动编号获取失败\n',
          apiTokenInvalid: 'API令牌的权限设置不正确'
        }
      }
    },
    settings: {
      lang: 'en',
      i18n: 'en',
      events: {
        onShow: [
          'app.record.create.show',
          'app.record.edit.show',
          'app.record.index.edit.show'
        ],
        onSubmit: ['app.record.create.submit']
      },
      config: {
        plugin: kintone.plugin.app.getConfig(PLUGIN_ID)
      }
    },
    CONSTANT: {
      NUMBERING_DEFAULT: 1,
      MAX_RESET_TIMES: 12,
      MAX_LENGTH_OF_DIGIT_NUMBER: 10,
      MIN_LENGTH_OF_DIGIT_NUMBER: 1,
    },
    getLastNumberTimes: 0,
    init: function() {
      if (!this.settings.config.plugin) {
        return false;
      }
      const user = kintone.getLoginUser();
      this.settings.lang = user.language;
      this.settings.i18n = this.settings.lang in this.lang ? this.lang[this.settings.lang] : this.lang.en;

      this.settings.config.TEXT = this.settings.config.plugin.text;
      this.settings.config.FIELD_CODE = this.settings.config.plugin.autoNumberingFieldcode;
      this.settings.config.SELECT_FORMAT = this.settings.config.plugin.format;
      this.settings.config.DATE_SELECT_FORMAT = this.settings.config.plugin.dateFormat;
      this.settings.config.CONNECTIVE = this.settings.config.plugin.connective;
      this.settings.config.RESET_TIMING = this.settings.config.plugin.timing;
      this.settings.config.FORMAT = [
        this.settings.config.plugin.format1,
        this.settings.config.plugin.format2,
        this.settings.config.plugin.format3
      ];
      this.settings.config.NUM_OF_DIGIT = parseInt(this.settings.config.plugin.numOfDigit, 10);

      this.kintoneEvents();
    },
    kintoneEvents: function() {
      const self = this;
      kintone.events.on(this.settings.events.onShow, (event) => {
        const record = event.record;
        record[self.settings.config.FIELD_CODE].disabled = true;
        if (event.type === 'app.record.create.show') {
          record[self.settings.config.FIELD_CODE].value = '';
        }
        return event;
      });
      // Get last record, parse id and increased 1
      kintone.events.on(this.settings.events.onSubmit, (event) => {


        const query = `${self.settings.config.FIELD_CODE} != "" order by $id desc limit 1`;
        return self.apiRequest(query).then((respdata) => {
          return self.getFormatNumberBy(respdata);
        }).then((numberingWithFormat) => {
          event.record[self.settings.config.FIELD_CODE].value = numberingWithFormat;
          return event;

        }).catch((error) => {
          self.alertMessage(self.settings.i18n.alertMessage.failedAutoNumbering + ': ' + error.message);
          return false;
        });
      });
    },
    getFormatNumberBy: function(resp) {
      let newNumberWithDigit, formatWithOutNumber, lastRecordFormatWithNumber;
      const self = this;
      return new kintone.Promise((resolve, _reject) => {
        if (
          !resp.records[0] ||
                    resp.records[0][self.settings.config.FIELD_CODE].value === ''
        ) {
          resolve(
            self.getFormatWithOutNumber() +
                          self.createWithNumberOfDigit(self.CONSTANT.NUMBERING_DEFAULT)
          );
          return;
        }
        formatWithOutNumber = self.getFormatWithOutNumber();
        lastRecordFormatWithNumber =
                    resp.records[0][self.settings.config.FIELD_CODE].value;
        if (!self.checkNeedReset(resp)) {
          newNumberWithDigit = self.createWithNumberOfDigit(
            self.getNumberBy(lastRecordFormatWithNumber) + 1
          );
          resolve(formatWithOutNumber + newNumberWithDigit);
          return;
        }
        // setting format only has number
        if (
          self.settings.config.SELECT_FORMAT === 'numbering'
        ) {
          newNumberWithDigit = self.createWithNumberOfDigit(
            self.CONSTANT.NUMBERING_DEFAULT
          );
          resolve(formatWithOutNumber + newNumberWithDigit);
          return;
        }
        self.getLastNumberTimes = self.CONSTANT.MAX_RESET_TIMES;
        self.getLastNumberBy(formatWithOutNumber, []).then((number) => {
          newNumberWithDigit = self.createWithNumberOfDigit(number);
          resolve(formatWithOutNumber + newNumberWithDigit);
        });
      });
    },
    /**
         * params:{targetFormat: string, notLikeFormats: string[]}
         */
    getLastNumberBy: function(targetFormat, notLikeFormats) {
      let query;
      const self = this;
      let formatResult;
      let lastFormatWithNumber;
      return new kintone.Promise((resolve, _reject) => {
        query = self.createQueryForRecordsApi(targetFormat, notLikeFormats);
        self.apiRequest(query).then((resp) => {
          if (!resp.records || !resp.records[0]) {
            resolve(self.CONSTANT.NUMBERING_DEFAULT);
            return;
          }
          lastFormatWithNumber =
                        resp.records[0][self.settings.config.FIELD_CODE].value;
          formatResult = self.getFormatBy(lastFormatWithNumber);
          if (formatResult === targetFormat) {
            resolve(self.getNumberBy(lastFormatWithNumber) + 1);
            return;
          }
          self.getLastNumberTimes--;
          if (self.getLastNumberTimes === 0) {
            resolve(self.getLastNumberByFromAllRecords(targetFormat));
            return;
          }
          notLikeFormats.push(formatResult);
          resolve(self.getLastNumberBy(targetFormat, notLikeFormats));
        });
      });
    },
    createQueryForRecordsApi: function(targetFormat, notLikeFormats) {
      const self = this;
      let query =
                this.settings.config.FIELD_CODE + ' like "' + targetFormat + '"';
      notLikeFormats.forEach((notLikeFormat) => {
        query =
                  query +
                  ' and ' +
                  self.settings.config.FIELD_CODE +
                  ' not like "' +
                  notLikeFormat +
                  '"';
      });
      query += 'order by $id desc limit 1';
      return query;
    },
    getFormatBy: function(formatWithNumber) {
      const index = formatWithNumber.lastIndexOf(this.settings.config.CONNECTIVE);
      if (index === -1) {
        return '';
      }
      return formatWithNumber.substr(0, index + 1);
    },
    getNumberBy: function(formatWithNumber) {
      const index = formatWithNumber.lastIndexOf(this.settings.config.CONNECTIVE);
      const result = formatWithNumber.substr(index + 1);
      return parseInt(result, 10);
    },
    getFormatWithOutNumber: function() {
      let date = '';
      if (this.settings.config.DATE_SELECT_FORMAT !== 'null') {
        date = moment(new Date()).format(
          this.settings.config.DATE_SELECT_FORMAT
        );
      }
      switch (this.settings.config.SELECT_FORMAT) {
        case 'dateNumbering':
          return date + this.settings.config.CONNECTIVE;

        case 'dateTextNumbering':
          return (
            date +
                        this.settings.config.CONNECTIVE +
                        this.settings.config.TEXT +
                        this.settings.config.CONNECTIVE
          );

        case 'textNumbering':
          return this.settings.config.TEXT + this.settings.config.CONNECTIVE;

        case 'textDateNumbering':
          return (
            this.settings.config.TEXT +
                      this.settings.config.CONNECTIVE +
                      date +
                      this.settings.config.CONNECTIVE
          );

        default:
          return '';
      }
    },
    checkNeedReset: function(respdata) {
      const lastAutonum =
              respdata.records[0][this.settings.config.FIELD_CODE].value;
      let index = 0;
      const formats = this.settings.config.FORMAT;
      const self = this;
      const reg = this.createRegExpBySettingFormat();
      if (!reg.test(lastAutonum)) {
        return true;
      }
      for (index; index < formats.length; index++) {
        if (
          formats[index] === 'date' &&
                    self.checkDateFormat(
                      lastAutonum.split(self.settings.config.CONNECTIVE)[index]
                    )
        ) {
          return true;
        }
      }
      return false;
    },
    createRegExpBySettingFormat: function() {
      const self = this;
      let regStr = '^';
      const formats = this.settings.config.FORMAT;
      formats.forEach((format, index) => {
        if (index !== 0 && format !== '') {
          regStr += self.settings.config.CONNECTIVE;
        }
        switch (format) {
          case 'date':
            regStr =
                        regStr +
                        '\\d{' +
                        self.settings.config.DATE_SELECT_FORMAT.length +
                        '}';
            break;
          case 'text':
            regStr += self.settings.config.TEXT;
            break;
          case 'number':
            regStr +=
                        '\\d{' +
                        self.CONSTANT.MIN_LENGTH_OF_DIGIT_NUMBER +
                        ',' +
                        self.CONSTANT.MAX_LENGTH_OF_DIGIT_NUMBER +
                        '}';
            break;
        }
      });
      regStr += '$';
      return new RegExp(regStr);
    },
    getLastNumberByFromAllRecords: function(targetFormat) {
      const self = this;
      return new kintone.Promise((resolve, _reject) => {
        const query =
                  self.settings.config.FIELD_CODE + ' like "' + targetFormat + '"';
        self.getAllRecordsByApi(query)
          .then((resp) => {
            let index = 0;
            if (!resp || resp.length === 0) {
              resolve(self.CONSTANT.NUMBERING_DEFAULT);
              return;
            }
            const reg = self.createRegExpBySettingFormat();
            for (index; index < resp.length; index++) {
              if (
                reg.test(resp[index][self.settings.config.FIELD_CODE].value)
              ) {
                resolve(
                  self.getNumberBy(
                    resp[index][self.settings.config.FIELD_CODE].value
                  ) + 1
                );
                return;
              }
            }
          });
      });
    },
    getAllRecordsByApi: function(query) {
      return this.getAllRecordsWithOffset(query, 0, []);
    },
    getAllRecordsWithOffset: function(query, offset, records) {
      const self = this;
      return new kintone.Promise((resolve, reject)=> {
        const GET_RECORDS_LIMIT = 500;
        const conditionQuery = query + 'order by $id desc limit ' + GET_RECORDS_LIMIT + ' offset ' + offset;
        self.apiRequest(conditionQuery).then((resp)=> {
          const allRecords = records.concat(resp.records);
          if (resp.records.length < GET_RECORDS_LIMIT) {
            resolve(allRecords);
            return;
          }
          resolve(self.getAllRecordsWithOffset(query, offset + GET_RECORDS_LIMIT, allRecords));
        }).catch((error)=> {
          reject(error);
        });
      });
    },
    apiRequest: function(query) {
      const self = this;
      let appUrl = '';
      const params = {
        app: kintone.app.getId(),
        fields: self.settings.config.FIELD_CODE,
        query: query
      };
      return new kintone.Promise((resolve, reject) => {
        if (self.settings.config.plugin.useProxy > 0) {
          appUrl = kintone.api.urlForGet('/k/v1/records', params, true);
          kintone.plugin.app.proxy(PLUGIN_ID, appUrl, 'GET', {}, {}, (respdata) => {
            const responeDataJson = JSON.parse(respdata);
            if (responeDataJson.records) {
              resolve(responeDataJson);
            } else {
              self.alertMessage(self.settings.i18n.alertMessage.apiTokenInvalid);
            }

          }, (error) => {
            reject(error);
          });
        } else {
          appUrl = kintone.api.url('/k/v1/records', true);
          kintone.api(appUrl, 'GET', params, (respdata) => {
            if (respdata.records) {
              resolve(respdata);
            } else {
              self.alertMessage(self.settings.i18n.alertMessage.apiTokenInvalid);
            }
          }, (error) => {
            reject(error);
          });
        }
      });
    },
    createWithNumberOfDigit: function(number) {
      if (number.toString().length >= this.settings.config.NUM_OF_DIGIT) {
        return number;
      }
      return (new Array(this.settings.config.NUM_OF_DIGIT).join('0') + number)
        .slice(-1 * this.settings.config.NUM_OF_DIGIT);
    },
    checkDateFormat: function(dateFormatOfLastRecordAutonum) {
      const currentDateFormat = moment().format(
        this.settings.config.DATE_SELECT_FORMAT
      );
      // 頭1文字で比較(桁数が同じ場合の制御で「西暦(4桁)」「月日(4桁)」、「テキスト設定」「日付」の比較用)
      if (
        dateFormatOfLastRecordAutonum.substr(0, 1) !==
              currentDateFormat.substr(0, 1)
      ) {
        return true;
      }

      // 日付によるリセットタイミングの確認
      if (
        this.timingIsDateReset(dateFormatOfLastRecordAutonum, currentDateFormat)
      ) {
        return true;
      }
      return false;
    },
    timingIsDateReset: function(before, after) {
      switch (this.settings.config.RESET_TIMING) {
        case 'yearly':
          if (this.timingGetYear(before) !== this.timingGetYear(after)) {
            return true;
          }
          return false;

        case 'monthly':
          if (this.timingGetYear(before) + this.timingGetMonth(before) !==
                            this.timingGetYear(after) + this.timingGetMonth(after)) {
            return true;
          }
          return false;
        case 'daily':
          if (before !== after) {
            return true;
          }
          return false;

        default:
          return false;
      }
    },
    timingGetYear: function(stringDate) {
      const position = {start: 0, end: 0};
      if (this.settings.config.DATE_SELECT_FORMAT === 'MMDDYYYY' ||
                this.settings.config.DATE_SELECT_FORMAT === 'MMDDYY') {
        position.start = 4; // diff 2 char from MMDD
      } else if (this.settings.config.DATE_SELECT_FORMAT === 'MMYY' ||
                        this.settings.config.DATE_SELECT_FORMAT === 'MMYYYY') {
        position.start = 2; // diff 2 char from MM
      }

      if (this.settings.config.DATE_SELECT_FORMAT === 'YY' ||
                this.settings.config.DATE_SELECT_FORMAT === 'MMDDYY' ||
                this.settings.config.DATE_SELECT_FORMAT === 'MMYY') {
        position.end = 2; // Year with 2 character
      } else {
        position.end = 4; // Year with 4 character
      }
      return stringDate.substr(position.start, position.end);
    },
    timingGetMonth: function(stringDate) {
      const position = {start: 0, end: 2}; // end = 2 because month always come with 2 character
      if (this.settings.config.DATE_SELECT_FORMAT === 'YYYYMMDD' ||
                this.settings.config.DATE_SELECT_FORMAT === 'YYYYMM') {
        position.start = 4; // Year with 4 characters
      }
      return stringDate.substr(position.start, position.end);
    },
    alertMessage: function(message) {
      const alertButtonClose = $('<span class="close"></span>'),
        alertMessage = $('<div class="kintoneplugin-alert popup"><span>' + message + '</span></div>');
      alertButtonClose.click(function() {
        $(this).parents('.kintoneplugin-alert-popup').remove();
      });
      alertMessage.append(alertButtonClose);
      $('body').append($('<div class="kintoneplugin-alert-popup"></div>').append(alertMessage));
    }

  };
  kintonePluginAutonum.init();
})(kintone.$PLUGIN_ID, jQuery);
